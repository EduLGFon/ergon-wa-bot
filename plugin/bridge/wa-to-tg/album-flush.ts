// Album flush worker - buffers photo bursts into media groups.
//
// Photos/videos wait out ALBUM_WINDOW_MS so rapid bursts cross as one
// Telegram media group instead of N singles - any other message flushes the
// pending group first so chat order is preserved, singletons fall back to
// the normal send path.
import {
	ALBUM_WINDOW_MS,
	albumKey,
	MAX_ALBUM_BYTES,
	MAX_ALBUM_ITEMS,
	pendingAlbums,
} from './album.ts'
import { notifyTopic, relayCtx, shortErr } from './state.ts'
import { sendAlbumChunk } from './album-send.ts'
import type { AlbumItem } from './album.ts'
import { sendToTopic } from './send.ts'
import { isQueueDrop } from '../rate-limiter.ts'
import { proto } from 'baileys'

export function bufferAlbumItem(jid: string, m: proto.IWebMessageInfo, item: AlbumItem): void {
	const key = albumKey(jid, m)
	const existing = pendingAlbums.get(key)
	if (existing) {
		const queuedBytes = existing.items.reduce((n, it) => n + it.media.buffer.length, 0)
		if (
			existing.items.length >= MAX_ALBUM_ITEMS ||
			queuedBytes + item.media.buffer.length > MAX_ALBUM_BYTES
		) {
			void flushAlbum(key).catch((e) => console.error('[BRIDGE] album flush failed:', e))
		} else {
			existing.items.push(item)
			return
		}
	}
	const timer = setTimeout(() => {
		void flushAlbum(key).catch((e) => console.error('[BRIDGE] album flush failed:', e))
	}, ALBUM_WINDOW_MS)
	pendingAlbums.set(key, { items: [item], timer })
}

// Flush every pending album group of a chat (called before a non-eligible
// message sends, preserving chat order).
export async function flushPendingAlbums(jid: string): Promise<void> {
	const keys = [...pendingAlbums.keys()].filter((k) => k.startsWith(`${jid}\n`))
	for (const key of keys) await flushAlbum(key)
}

export async function flushAlbum(key: string): Promise<void> {
	const entry = pendingAlbums.get(key)
	if (!entry) return
	pendingAlbums.delete(key)
	clearTimeout(entry.timer)
	const { items } = entry
	const { db, limiter, tg } = relayCtx
	if (items.length === 0 || !db || !limiter || !tg) return
	const jid = key.split('\n')[0]
	const mapping = db.getByJidOrAlias(jid)
	if (!mapping || mapping.archived || mapping.muted) return
	const chatId = mapping.telegram_chat_id || relayCtx.groups.personal

	if (items.length === 1) {
		const it = items[0]
		try {
			await sendToTopic(
				it.topicId,
				it.chatId || chatId,
				it.body,
				it.entities,
				it.media,
				null,
				jid,
				it.m,
				{
					tgId: it.replyToTgId,
					header: null,
				},
			)
		} catch (e) {
			if (isQueueDrop(e)) {
				parkAlbumItems(db, items)
				return
			}
			console.error('[BRIDGE] failed to relay album singleton:', e)
		}
		return
	}

	// Telegram caps media groups at 10 - chunk larger bursts.
	for (let c = 0; c < items.length; c += 10) {
		const chunk = items.slice(c, c + 10)
		const first = chunk[0]
		try {
			await sendAlbumChunk(jid, chatId, chunk)
		} catch (e) {
			if (isQueueDrop(e)) {
				parkAlbumItems(db, chunk)
				continue
			}
			console.error('[BRIDGE] failed to relay album group:', e)
			await notifyTopic(
				chatId,
				first.topicId,
				`⚠️ Couldn't relay a photo group (${chunk.length} photos): ${shortErr(e)}`,
			)
		}
	}
}

function parkAlbumItems(db: NonNullable<typeof relayCtx.db>, items: AlbumItem[]): void {
	try {
		for (const it of items) {
			db.enqueueOutbox(proto.WebMessageInfo.encode(it.m).finish())
		}
		console.warn(`[BRIDGE] album shed - parked ${items.length} WA message(s) in outbox`)
	} catch (e) {
		console.error('[BRIDGE] failed to park album batch:', e)
	}
}
