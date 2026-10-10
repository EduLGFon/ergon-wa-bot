// Same-sender text coalescing - rapid bursts join into one message.
//
// A fast typist (or a reconnect backlog) can spray N one-line texts that
// each cost a Telegram API slot and a notification. Text-only messages
// from the same sender in the same chat wait out a short sliding window
// and cross as one body (one label, parts joined by newline), so bursts
// cost one send instead of N. The window stretches while the flood queue
// is deep, so backpressure joins more instead of only delaying more.
//
// Trade-off: one Telegram message keeps one reply_map row, so only the
// first WA id of a joined batch resolves for later quotes, edits and
// deletes - follow-ups degrade to the unmapped fallbacks. Media, polls,
// contacts, locations, replies and quoted messages flush any pending burst
// first and always send alone, so chat order is preserved.
import { limiterFor, notifyTopic, relayCtx, shortErr } from './state.ts'
import { isQueueDrop } from '../rate-limiter.ts'
import type { TgEntity } from '../format.ts'
import { sendToTopic } from './send.ts'
import { albumKey } from './album.ts'
import type { proto } from 'baileys'

// Base join window, stretched while the TG queue is deep (see windowFor).
// Override with BRIDGE_COALESCE_MS. Album bursts use their own window.
function baseWindowMs(): number {
	const raw = Number(Deno.env.get('BRIDGE_COALESCE_MS') || '')
	return Number.isFinite(raw) && raw >= 0 ? raw : 1800
}

function maxItems(): number {
	const raw = Number(Deno.env.get('BRIDGE_COALESCE_MAX') || '')
	return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 5
}

// Joined bodies stay well under the 4096 Telegram cap (chunking would
// split the rest, but one burst should stay one message when possible).
const MAX_JOINED_CHARS = 3500

// Window for this destination: the base window, stretched while the lane
// is under pressure (deep queue, parked producers, post-reconnect flood),
// so a burst that would arrive late anyway arrives joined instead.
function windowFor(chatId: string): number {
	const base = baseWindowMs()
	try {
		const pressure = limiterFor(chatId)?.pressure ?? 0
		if (pressure >= 100) return Math.max(base, 6000)
		if (pressure >= 20) return Math.max(base, 4000)
	} catch {
		// Pressure read failed - fall back to the base window.
	}
	return base
}

// True when a prepared dispatch may join the burst buffer: plain texts
// only. Quote and reply context is checked by the caller (dispatch.ts).
export function canCoalesceText(
	media: { kind: string } | null,
	special: unknown,
	text: string,
): boolean {
	return !media && !special && text.trim().length > 0
}

interface CoalescedPart {
	text: string
	entities: TgEntity[]
}

interface CoalescedEntry {
	m: proto.IWebMessageInfo
	label: string
	parts: CoalescedPart[]
	chars: number
	timer: ReturnType<typeof setTimeout>
}

// Pure join: one label plus newline-joined parts, entities rebased past
// the label and every earlier part (plus its newline). Exported for
// targeted smokes; flushCoalescedKey is the only other caller.
export function joinParts(
	label: string,
	parts: CoalescedPart[],
): { body: string; entities: TgEntity[] } {
	const body = `${label}${parts.map((p) => p.text).join('\n')}`
	const entities: TgEntity[] = []
	let offset = label.length
	for (const part of parts) {
		for (const e of part.entities) entities.push({ ...e, offset: e.offset + offset })
		offset += part.text.length + 1
	}
	entities.sort((a, b) => a.offset - b.offset)
	return { body, entities }
}

const pendingCoalesced = new Map<string, CoalescedEntry>()

export function bufferCoalesced(
	jid: string,
	m: proto.IWebMessageInfo,
	part: { topicId: number; chatId: string; label: string; text: string; entities: TgEntity[] },
): void {
	const key = albumKey(jid, m)
	let entry = pendingCoalesced.get(key)
	if (
		entry &&
		(entry.label !== part.label || entry.parts.length >= maxItems() ||
			entry.chars + part.text.length > MAX_JOINED_CHARS)
	) {
		// Label changed mid-burst, or the batch is full: flush what waits
		// (fire-and-forget, the queue keeps FIFO order) and start fresh.
		void flushCoalescedKey(key).catch((e) =>
			console.error('[BRIDGE] coalesce flush failed:', e)
		)
		entry = undefined
	}
	const timer = setTimeout(() => {
		void flushCoalescedKey(key).catch((e) =>
			console.error('[BRIDGE] coalesce flush failed:', e)
		)
	}, windowFor(part.chatId))
	if (entry) {
		// Sliding window: every new part restarts the wait, so an ongoing
		// burst keeps joining (capped by maxItems above) instead of
		// spraying one message per window.
		clearTimeout(entry.timer)
		entry.timer = timer
		entry.parts.push({ text: part.text, entities: part.entities })
		entry.chars += part.text.length
		return
	}
	pendingCoalesced.set(key, {
		m,
		label: part.label,
		parts: [{ text: part.text, entities: part.entities }],
		chars: part.text.length,
		timer,
	})
}

// Flush every pending burst of a chat (called before a message that sends
// alone, preserving chat order).
export async function flushCoalesced(jid: string): Promise<void> {
	const keys = [...pendingCoalesced.keys()].filter((k) => k.startsWith(`${jid}\n`))
	for (const key of keys) await flushCoalescedKey(key)
}

async function flushCoalescedKey(key: string): Promise<void> {
	const entry = pendingCoalesced.get(key)
	if (!entry) return
	pendingCoalesced.delete(key)
	clearTimeout(entry.timer)
	if (entry.parts.length === 0) return
	const { db, limiter, tg } = relayCtx
	if (!db || !limiter || !tg) return
	const jid = key.split('\n')[0]
	const mapping = db.getByJidOrAlias(jid)
	if (!mapping || mapping.archived || mapping.muted) return
	const chatId = mapping.telegram_chat_id || relayCtx.groups.personal
	const topicId = mapping.telegram_topic_id
	const { body, entities } = joinParts(entry.label, entry.parts)
	// One send for the whole burst; only the first WA id keeps a mirror
	// row (see header). Singleton bursts cross exactly as before.
	try {
		await sendToTopic(topicId, chatId, body, entities, null, null, jid, entry.m, {
			tgId: null,
			header: null,
		})
	} catch (e) {
		// Load-shed drops are intentional - they only hit the server log.
		// Anything else becomes a topic notice: without it a joined burst
		// would vanish silently (dispatch already returned by flush time).
		if (isQueueDrop(e)) {
			console.error('[BRIDGE] coalesced batch shed under pressure:', e)
			return
		}
		console.error('[BRIDGE] failed to relay coalesced batch:', e)
		await notifyTopic(chatId, topicId, `⚠️ Couldn't relay WhatsApp messages: ${shortErr(e)}`)
	}
}
