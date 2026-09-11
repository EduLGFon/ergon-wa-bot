// Telegram message handler - main TG->WA relay path.
// Reaction and edit handlers live in handler-events.ts.
import { bucketOfChat, type GroupIds } from '../wa-to-tg/routing.ts'
import { notifyTopic, shortErr, tgDownloadFailureLine } from './replies.ts'
import { buildQuoted, buildWaContent, tgPollOptions } from './content.ts'
import { selfJid } from '../wa-to-tg/jid.ts'
import type { RateLimiter } from '../rate-limiter.ts'
import { bufferTgAlbumItem } from './album.ts'
import { tgEntitiesToWa } from '../format.ts'
import { downloadTgMedia } from './media.ts'
import type { BridgeDB } from '../db.ts'
import type { Bot } from 'grammy'
import bot from '@plugin/bot.ts'

type WaSend = <T>(fn: () => Promise<T>) => Promise<T>

export function registerTgMessageHandler(
	tg: Bot,
	db: BridgeDB,
	tgLimiter: RateLimiter,
	waSend: WaSend,
	groups: GroupIds,
): void {
	const mutedNoticeAt = new Map<string, number>()
	tg.on('message', async (ctx) => {
		let chatId = ''
		try {
			const msg: any = ctx.msg
			chatId = String(ctx.chat?.id ?? '')
			if (bucketOfChat(chatId, groups) === null || msg.from?.is_bot) return
			const topicId = msg.message_thread_id
			if (!topicId) return
			const mapping = db.getByTopic(chatId, topicId)
			if (!mapping || mapping.archived || mapping.muted) {
				// Throttle key includes the group - topic IDs collide across groups.
				const noticeKey = `${chatId}:${topicId}`
				const last = mutedNoticeAt.get(noticeKey) ?? 0
				if (Date.now() - last > 3_600_000) {
					mutedNoticeAt.set(noticeKey, Date.now())
					const line = !mapping || mapping.archived
						? '⚠️ This chat is archived - relay is paused. Use /reopen to resume.'
						: '⚠️ This chat is muted - relay is paused. Use /unmute to resume.'
					await notifyTopic(tg, tgLimiter, chatId, topicId, line)
				}
				return
			}
			const rawText = msg.text || msg.caption || ''
			const text = tgEntitiesToWa(rawText, msg.entities || msg.caption_entities).trim()
			const dl = await downloadTgMedia(tg, msg)
			const media = dl?.media ?? null
			const unsupportedLabel = msg.dice
				? 'dice'
				: msg.venue
				? 'venue'
				: msg.game
				? 'game'
				: msg.video_chat_started || msg.video_chat_ended ||
						msg.video_chat_participants_invited
				? 'video chat event'
				: null
			if (
				!text && !media && !msg.location && !msg.contact && !msg.poll && !msg.video_note &&
				!msg.animation && !unsupportedLabel
			) return
			if (unsupportedLabel && !text && !media) {
				await notifyTopic(
					tg,
					tgLimiter,
					chatId,
					topicId,
					`⚠️ A Telegram ${unsupportedLabel} has no WhatsApp equivalent - it didn't cross.`,
				)
				return
			}
			if (dl && !dl.media) {
				await notifyTopic(
					tg,
					tgLimiter,
					chatId,
					topicId,
					tgDownloadFailureLine(dl.label, dl.bytes, dl.tooLarge),
				)
				if (!text) return
			}
			const groupId = msg.media_group_id as string | undefined
			if (groupId && media && (media.kind === 'image' || media.kind === 'video')) {
				bufferTgAlbumItem(groupId, { msg, topicId, chatId, text, media }, {
					db,
					tg,
					tgLimiter,
					waSend,
				})
				return
			}
			const quoted = buildQuoted(msg, mapping.whatsapp_jid, db, chatId)
			let textForWa = text
			if (!quoted && msg.reply_to_message) {
				const author = msg.reply_to_message.from?.first_name ||
					msg.reply_to_message.from?.username || 'user'
				const preview = (msg.reply_to_message.text || msg.reply_to_message.caption || '')
					.slice(0, 200)
				if (preview) textForWa = `↩️ ${author}: ${preview}\n${text}`.trim()
			}
			const waContent = await buildWaContent(textForWa, media, msg)
			if (!waContent) return
			const needsTextFollowUp = !!textForWa &&
				(!!msg.location || !!msg.video_note || !!msg.poll ||
					(msg.contact && !String(waContent.text || '').includes(textForWa)))
			await waSend(async () => {
				const sent = await bot.sock.sendMessage(
					mapping.whatsapp_jid,
					waContent,
					quoted ? { quoted } : undefined,
				)
				if (sent?.key?.id) {
					db.saveReplyMap(
						msg.message_id,
						mapping.whatsapp_jid,
						sent.key.id,
						JSON.stringify(sent.key),
						'unknown',
						null,
						null,
						{
							chatId,
							replyTo: msg.reply_to_message?.message_id ?? null,
						},
					)
					// Telegram-created polls become native WA polls - keep the
					// metadata so votes relay both ways (the secret backfills
					// from the send echo, the creator is always us).
					const pollId = msg.poll?.id
					const pollOpts = msg.poll ? tgPollOptions(msg) : null
					if (pollId && pollOpts) {
						db.savePollMeta(chatId, msg.message_id, {
							secret: null,
							options: pollOpts,
							creator: selfJid(),
							pollId,
						})
					}
				}
				if (needsTextFollowUp) {
					const follow = await bot.sock.sendMessage(mapping.whatsapp_jid, {
						text: textForWa,
					})
					if (follow?.key?.id) db.markFollowUp(follow.key.id)
				}
				db.updateLastActive(mapping.whatsapp_jid)
			})
		} catch (e) {
			console.error('[BRIDGE] TG->WA relay failed:', e)
			const topicId = (ctx.msg as any)?.message_thread_id
			if (topicId && chatId) {
				await notifyTopic(
					tg,
					tgLimiter,
					chatId,
					topicId,
					`⚠️ Couldn't send to WhatsApp: ${shortErr(e)}`,
				)
			}
		}
	})
}
