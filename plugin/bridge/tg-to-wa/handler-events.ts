// Telegram reaction and edit handlers - lightweight event paths.
// Split from handlers.ts so each file stays under the size budget.
import { bucketOfChat, type GroupIds } from '../wa-to-tg/routing.ts'
import { restoreWaKey, tgReactionToWaEmoji } from './content.ts'
import { sendWaPollVote } from '../wa-to-tg/polls.ts'
import type { RateLimiter } from '../rate-limiter.ts'
import { notifyTopic } from './replies.ts'
import { tgEntitiesToWa } from '../format.ts'
import type { BridgeDB } from '../db.ts'
import type { Bot } from 'grammy'
import bot from '@plugin/bot.ts'

type WaSend = <T>(fn: () => Promise<T>) => Promise<T>

export function registerTgReactionHandler(
	tg: Bot,
	db: BridgeDB,
	waSend: WaSend,
	groups: GroupIds,
): void {
	tg.on('message_reaction', async (ctx) => {
		try {
			const upd: any = ctx.update.message_reaction
			const chatId = String(upd?.chat?.id ?? '')
			if (!upd || bucketOfChat(chatId, groups) === null) return
			if (upd.user?.is_bot || !upd.message_id) return
			const entry = db.getReplyMapAt(chatId, upd.message_id)
			if (!entry || db.getByJid(entry.wa_jid)?.muted) return
			const key = restoreWaKey(entry)
			if (!key) return
			const emoji = tgReactionToWaEmoji(upd.old_reaction, upd.new_reaction)
			db.markTgReact(entry.wa_jid, entry.wa_msg_id, emoji)
			await waSend(() => bot.sock.sendMessage(entry.wa_jid, { react: { text: emoji, key } }))
		} catch (e) {
			console.error('[BRIDGE] TG->WA reaction failed:', e)
		}
	})
}

// Telegram pin handler - pinned service messages in one place.
//
// Pinning a message posts a pinned_message service message (no text) which
// the main message handler drops silently - this resolves the WA original
// through reply_map and pins it for 30 days instead. Unpins emit no update
// at all, so TG to WA unpin sync is impossible.
export function registerTgPinHandler(
	tg: Bot,
	db: BridgeDB,
	waSend: WaSend,
	groups: GroupIds,
): void {
	tg.on('message', async (ctx) => {
		try {
			const msg: any = ctx.msg
			const pinned = msg?.pinned_message
			if (!pinned) return
			const chatId = String(ctx.chat?.id ?? '')
			if (bucketOfChat(chatId, groups) === null || msg.from?.is_bot) return
			const topicId = msg.message_thread_id
			if (!topicId) return
			const mapping = db.getByTopic(chatId, topicId)
			if (!mapping || mapping.archived || mapping.muted) return
			const entry = db.getReplyMapAt(chatId, pinned.message_id)
			if (!entry) return
			const key = restoreWaKey(entry)
			if (!key) return
			db.markTgPin(entry.wa_jid, entry.wa_msg_id)
			await waSend(async () => {
				await bot.sock.sendMessage(entry.wa_jid, {
					pin: key,
					type: 1,
					time: 2592000,
				})
				db.updateLastActive(entry.wa_jid)
			})
		} catch (e) {
			console.error('[BRIDGE] TG->WA pin failed:', e)
		}
	})
}

// Telegram poll-answer handler - votes on mirrored WA polls in one place.
//
// poll_answer updates carry the bot poll id but no chat, so the stored
// Telegram poll id resolves the WA poll. The vote is cast by the owner's
// account (single-user bridge); its echo feeds the WA-side tally like any
// other vote.
export function registerTgPollAnswerHandler(
	tg: Bot,
	db: BridgeDB,
	waSend: WaSend,
	groups: GroupIds,
	tgLimiter: RateLimiter,
): void {
	tg.on('poll_answer', async (ctx) => {
		try {
			const ans: any = ctx.pollAnswer
			if (!ans || ans.user?.is_bot || !ans.poll_id) return
			const entry = db.getReplyMapByPollId(ans.poll_id)
			if (!entry) return
			const mapping = db.getByJid(entry.wa_jid)
			if (!mapping || mapping.archived || mapping.muted) return
			const chatId = mapping.telegram_chat_id || groups.personal
			const topicId = mapping.telegram_topic_id
			let options: string[] = []
			try {
				const parsed: unknown = JSON.parse(entry.wa_poll_options || '[]')
				if (Array.isArray(parsed)) options = parsed.filter((o) => typeof o === 'string')
			} catch {
				options = []
			}
			const names = (Array.isArray(ans.option_ids) ? ans.option_ids : [])
				.map((i: number) => options[i])
				.filter((n: unknown): n is string => typeof n === 'string' && n.length > 0)
			if (!entry.wa_poll_secret || names.length === 0) {
				await notifyTopic(
					tg,
					tgLimiter,
					chatId,
					topicId,
					`⚠️ Couldn't vote on that poll from Telegram (unknown options or key).`,
				)
				return
			}
			await waSend(() => sendWaPollVote(entry, names))
			db.updateLastActive(entry.wa_jid)
		} catch (e) {
			console.error('[BRIDGE] TG->WA poll vote failed:', e)
		}
	})
}

export function registerTgEditHandler(
	tg: Bot,
	db: BridgeDB,
	waSend: WaSend,
	groups: GroupIds,
): void {
	tg.on('edited_message', async (ctx) => {
		try {
			const msg: any = ctx.editedMessage
			const chatId = String(ctx.chat?.id ?? '')
			if (!msg || bucketOfChat(chatId, groups) === null || msg.from?.is_bot) return
			const topicId = msg.message_thread_id
			if (!topicId) return
			const mapping = db.getByTopic(chatId, topicId)
			if (!mapping || mapping.archived || mapping.muted) return
			const rawText = msg.text || msg.caption || ''
			const text = tgEntitiesToWa(rawText, msg.entities || msg.caption_entities).trim()
			if (!text) return
			const entry = db.getReplyMapAt(chatId, msg.message_id)
			if (!entry) return
			const key = restoreWaKey(entry)
			if (!key) return
			db.markTgEdit(mapping.whatsapp_jid, entry.wa_msg_id)
			await waSend(async () => {
				await bot.sock.sendMessage(mapping.whatsapp_jid, { text, edit: key })
				db.updateLastActive(mapping.whatsapp_jid)
			})
		} catch (e) {
			console.error('[BRIDGE] TG->WA edit failed:', e)
		}
	})
}
