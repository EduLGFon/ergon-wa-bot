// Telegram album batching - collect media_group_id items and flush in order.
// Hyphen-only header - plain ASCII dashes for all punctuation.
import { buildQuoted, buildWaContent } from './content.ts'
import type { RateLimiter } from '../rate-limiter.ts'
import { notifyTopic, shortErr } from './replies.ts'
import type { TgMedia } from './media.ts'
import type { BridgeDB } from '../db.ts'
import bot from '@plugin/bot.ts'
import { Bot } from 'grammy'

export interface TgAlbumDeps {
	db: BridgeDB
	tg: Bot
	tgLimiter: RateLimiter
	waSend: <T>(fn: () => Promise<T>) => Promise<T>
}

export interface TgAlbumItem {
	msg: any
	topicId: number
	chatId: string
	text: string
	media: TgMedia
}

// Telegram album batching (TG->WA). Items of one media_group_id arrive as
// separate updates; they wait out TG_ALBUM_WINDOW_MS and forward in
// message_id order through the normal single-send path (Baileys has no
// album-send API, so batching buys ordering, not a WA album).
const TG_ALBUM_WINDOW_MS = 1200
const pendingTgAlbums = new Map<
	string,
	{ items: TgAlbumItem[]; timer: ReturnType<typeof setTimeout> }
>()

export function bufferTgAlbumItem(groupId: string, item: TgAlbumItem, deps: TgAlbumDeps): void {
	// media_group_id is only unique per chat - scope the buffer key so the
	// two groups can never merge each other's albums.
	const key = `${item.chatId}\n${groupId}`
	const existing = pendingTgAlbums.get(key)
	if (existing) {
		if (existing.items.length < 10) existing.items.push(item)
		return
	}
	const timer = setTimeout(() => {
		void flushTgAlbum(key, deps).catch((e) =>
			console.error('[BRIDGE] TG album flush failed:', e)
		)
	}, TG_ALBUM_WINDOW_MS)
	pendingTgAlbums.set(key, { items: [item], timer })
}

export async function flushTgAlbum(bufferKey: string, deps: TgAlbumDeps): Promise<void> {
	const entry = pendingTgAlbums.get(bufferKey)
	if (!entry) return
	pendingTgAlbums.delete(bufferKey)
	clearTimeout(entry.timer)
	const items = entry.items
		.sort((a, b) => (a.msg.message_id || 0) - (b.msg.message_id || 0))
		.slice(0, 10)
	if (items.length === 0) return
	const first = items[0]
	const chatId = first.chatId
	const mapping = deps.db.getByTopic(chatId, first.topicId)
	if (!mapping || mapping.archived || mapping.muted) return
	const quoted = buildQuoted(first.msg, mapping.whatsapp_jid, deps.db, chatId)
	let attached = false
	let notified = false
	for (const [i, it] of items.entries()) {
		try {
			const waContent = await buildWaContent(it.text, it.media, it.msg)
			if (!waContent) continue
			const useQuoted = !attached ? quoted : null
			await deps.waSend(async () => {
				const sent = await bot.sock.sendMessage(
					mapping.whatsapp_jid,
					waContent,
					useQuoted ? { quoted: useQuoted } : undefined,
				)
				if (sent?.key?.id) {
					deps.db.saveReplyMap(
						it.msg.message_id,
						mapping.whatsapp_jid,
						sent.key.id,
						JSON.stringify(sent.key),
						'unknown',
						null,
						null,
						{
							chatId,
							replyTo: it.msg.reply_to_message?.message_id ?? null,
						},
					)
				}
				deps.db.updateLastActive(mapping.whatsapp_jid)
			})
			attached = true
		} catch (e) {
			console.error('[BRIDGE] TG→WA album item failed:', e)
			if (!notified) {
				notified = true
				await notifyTopic(
					deps.tg,
					deps.tgLimiter,
					chatId,
					first.topicId,
					`⚠️ Couldn't send part of a Telegram album (item ${
						i + 1
					} of ${items.length}): ${shortErr(e)}`,
				)
			}
		}
	}
}
