// TG-to-WA text coalescing - same-author bursts join into one send.
//
// Telegram splits a fast burst into one update per message and each used
// to cost its own WhatsApp send. Plain texts from the same author in the
// same topic wait out a short sliding window and cross joined by newline,
// so bursts cost one WA send instead of N. Replies, commands, media,
// polls and every other content kind flush any pending burst first and
// always send alone, so chat order is preserved.
import { notifyTopic, shortErr } from './replies.ts'
import type { RateLimiter } from '../rate-limiter.ts'
import type { BridgeDB } from '../db.ts'
import type { Bot } from 'grammy'
import bot from '@plugin/bot.ts'

export interface TgTextDeps {
	db: BridgeDB
	tg: Bot
	tgLimiter: RateLimiter
	waSend: <T>(fn: () => Promise<T>) => Promise<T>
}

function baseWindowMs(): number {
	const raw = Number(Deno.env.get('BRIDGE_TG_COALESCE_MS') || '')
	return Number.isFinite(raw) && raw >= 0 ? raw : 1500
}

const MAX_ITEMS = 5
const MAX_JOINED_CHARS = 3500

interface TgTextItem {
	msgId: number
	text: string
}

interface TgTextBuf {
	items: TgTextItem[]
	timer: ReturnType<typeof setTimeout>
}

const pendingTgText = new Map<string, TgTextBuf>()

function textKey(chatId: string, topicId: number, fromId: string): string {
	return `${chatId}\n${topicId}\n${fromId}`
}

// True when a Telegram message may join the burst buffer: plain texts
// only, no reply context, never commands (those keep current behavior).
export function canCoalesceTg(msg: any, text: string, media: unknown): boolean {
	if (!text || !text.trim() || media) return false
	if (msg.reply_to_message) return false
	if (msg.location || msg.contact || msg.poll || msg.video_note || msg.animation) return false
	if (msg.dice || msg.venue || msg.game) return false
	if (msg.video_chat_started || msg.video_chat_ended || msg.video_chat_participants_invited) {
		return false
	}
	if (text.trim().startsWith('/')) return false
	return true
}

export function bufferTgText(
	chatId: string,
	topicId: number,
	fromId: string,
	msgId: number,
	text: string,
	deps: TgTextDeps,
): void {
	const key = textKey(chatId, topicId, fromId)
	let buf = pendingTgText.get(key)
	if (buf) {
		const chars = buf.items.reduce((n, it) => n + it.text.length, 0)
		if (buf.items.length >= MAX_ITEMS || chars + text.length > MAX_JOINED_CHARS) {
			// Batch is full: flush what waits (fire-and-forget, the WA
			// queue keeps FIFO order) and start fresh below.
			void flushTgKey(key, deps).catch((e) =>
				console.error('[BRIDGE] TG coalesce flush failed:', e)
			)
			buf = undefined
		}
	}
	const timer = setTimeout(() => {
		void flushTgKey(key, deps).catch((e) =>
			console.error('[BRIDGE] TG coalesce flush failed:', e)
		)
	}, baseWindowMs())
	if (buf) {
		// Sliding window: an ongoing burst keeps joining (capped above)
		// instead of spraying one message per window.
		clearTimeout(buf.timer)
		buf.timer = timer
		buf.items.push({ msgId, text })
		return
	}
	pendingTgText.set(key, { items: [{ msgId, text }], timer })
}

// Flush one author's pending burst (called before their next send that
// goes alone, preserving per-author order).
export async function flushTgAuthor(
	chatId: string,
	topicId: number,
	fromId: string,
	deps: TgTextDeps,
): Promise<void> {
	await flushTgKey(textKey(chatId, topicId, fromId), deps)
}

async function flushTgKey(key: string, deps: TgTextDeps): Promise<void> {
	const buf = pendingTgText.get(key)
	if (!buf) return
	pendingTgText.delete(key)
	clearTimeout(buf.timer)
	if (buf.items.length === 0) return
	const [chatId, topicRaw] = key.split('\n')
	const topicId = Number(topicRaw)
	const mapping = deps.db.getByTopic(chatId, topicId)
	if (!mapping || mapping.archived || mapping.muted) return
	const joined = buf.items.map((it) => it.text).join('\n')
	if (!joined.trim()) return
	try {
		await deps.waSend(async () => {
			const sent = await bot.sock.sendMessage(mapping.whatsapp_jid, { text: joined })
			if (sent?.key?.id) {
				// One WA send mirrors N TG messages: every TG id keeps its
				// own row (same WA id), so TG-side edits and replies of any
				// part still resolve.
				const keyJson = JSON.stringify(sent.key)
				for (const it of buf.items) {
					deps.db.saveReplyMap(
						it.msgId,
						mapping.whatsapp_jid,
						sent.key.id,
						keyJson,
						'unknown',
						null,
						null,
						{ chatId },
					)
				}
			}
			deps.db.updateLastActive(mapping.whatsapp_jid)
		})
	} catch (e) {
		console.error('[BRIDGE] failed to relay coalesced TG batch:', e)
		await notifyTopic(
			deps.tg,
			deps.tgLimiter,
			chatId,
			topicId,
			`⚠️ Couldn't send to WhatsApp: ${shortErr(e)}`,
		)
	}
}
