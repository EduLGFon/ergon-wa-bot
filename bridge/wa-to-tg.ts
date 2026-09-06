// WhatsApp → Telegram relay.
//
// IMPORTANT: this module does NOT open its own WhatsApp connection. A second
// Baileys socket sharing the same auth state fights the main bot for the
// session (stream conflict / repeated logouts). Instead we piggyback on the
// already-running bot singleton from @plugin/bot.ts.
//
// Call `attachWaRelay()` AFTER `loadEvents()` in wa.ts — loadEvents() calls
// removeAllListeners() per event, so attaching earlier would wipe our hook.
import { downloadMediaMessage, type proto } from 'baileys'
import { Bot, InputFile } from 'grammy'
import { findKey } from '@util/functions.ts'
import { logger } from '@util/proto.ts'
import bot from '@plugin/bot.ts'
import type { BridgeDB } from './db.ts'
import type { RateLimiter } from './rate-limiter.ts'

let tg: Bot | null = null
let db: BridgeDB | null = null
let limiter: RateLimiter | null = null
let supergroupId: string | number = ''
const groupNameCache = new Map<string, string>()

export function attachWaRelay(tgBot: Bot, bridgeDb: BridgeDB, rateLimiter: RateLimiter): void {
	tg = tgBot
	db = bridgeDb
	limiter = rateLimiter
	supergroupId = Deno.env.get('TELEGRAM_SUPERGROUP_ID')!

	// Additional listener on the SHARED socket — the core bot handler stays untouched.
	bot.sock.ev.on('messages.upsert', async (raw: { messages: proto.IWebMessageInfo[] }) => {
		try {
			await handleWAMessages(raw.messages)
		} catch (e) {
			console.error('[BRIDGE] WA→TG handler failed:', e)
		}
	})
	// Reactions ride a separate event on the same shared socket. Attached
	// here (after loadEvents) for the same removeAllListeners reason.
	bot.sock.ev.on(
		'messages.reaction',
		async (reactions: { key: proto.IMessageKey; reaction: proto.IReaction }[]) => {
			try {
				await handleWaReactions(reactions)
			} catch (e) {
				console.error('[BRIDGE] WA→TG reaction handler failed:', e)
			}
		},
	)
	console.log('[BRIDGE] WA→TG relay attached to the shared WhatsApp socket')
}

async function handleWAMessages(messages: proto.IWebMessageInfo[]) {
	if (!db || !limiter || !tg) return

	for (const m of messages) {
		try {
			if (!m?.message || !m.key) continue
			// Skip our own messages: TG→WA sends re-emit here with fromMe=true,
			// relaying them would echo every Telegram reply back to Telegram.
			if (m.key.fromMe) continue
			// Skip protocol traffic (deletes, history sync, …)
			if (findKey(m.message, 'protocolMessage')) continue

			const jid = m.key.remoteJid
			if (!jid || jid === 'status@broadcast') continue
			const isGroup = jid.endsWith('@g.us')
			const chatType: '1:1' | 'group' = isGroup ? 'group' : '1:1'

			const displayName = await resolveChatName(jid, m.pushName, isGroup)
			const senderName = isGroup
				? (m.pushName || phoneOf(m.key.participant) || 'unknown')
				: displayName

			let mapping = db.getByJid(jid)
			if (!mapping || mapping.archived) {
				const topicId = await createForumTopic(displayName, isGroup)
				mapping = db.getOrCreate(jid, topicId, displayName, chatType)
				console.log(`[BRIDGE] new topic #${topicId} for ${jid} (${displayName})`)
			} else {
				if (mapping.display_name !== displayName) {
					mapping = db.getOrCreate(jid, mapping.telegram_topic_id, displayName, chatType)
				} else {
					db.updateLastActive(jid)
				}
			}
			const topicId = mapping.telegram_topic_id

			const text = getMsgText(m.message)
			const media = await downloadWaMedia(m)

			if (!text && !media) continue

			// WhatsApp quote → Telegram reply. Resolve the quoted stanzaId to
			// the Telegram message mirroring the original; when the original
			// was never bridged (history, pruned), fall back to a textual
			// quote header so context isn't silently lost.
			const quote = getQuoteInfo(m, displayName)
			let replyToTgId: number | null = null
			let quoteHeader: string | null = null
			if (quote) {
				const target = db.getByWaMsgId(quote.stanzaId, jid)
				if (target) {
					replyToTgId = target.tg_msg_id
				} else {
					quoteHeader = `↩️ ${quote.author}: ${quote.preview}`
				}
			}

			const label = isGroup ? `${senderName}: ` : ''
			await limiter.enqueue(() =>
				sendToTopic(topicId, label, text, media, jid, m, {
					tgId: replyToTgId,
					header: quoteHeader,
				})
			)
		} catch (e) {
			console.error('[BRIDGE] failed to relay one WA message:', e)
		}
	}
}

async function resolveChatName(
	jid: string,
	pushName: string | undefined | null,
	isGroup: boolean,
): Promise<string> {
	if (isGroup) {
		const cached = groupNameCache.get(jid)
		if (cached) return cached
		try {
			const meta = await bot.sock.groupMetadata(jid)
			if (meta?.subject) {
				groupNameCache.set(jid, meta.subject)
				return meta.subject
			}
		} catch {
			// fall through to pushName/phone
		}
		const fallback = pushName || jid.split('@')[0]
		groupNameCache.set(jid, fallback)
		return fallback
	}
	return pushName || phoneOf(jid) || jid.split('@')[0]
}

function phoneOf(jid: string | undefined | null): string {
	if (!jid) return ''
	const user = jid.split('@')[0].split(':')[0]
	return user ? `+${user}` : ''
}

// WhatsApp reaction → Telegram reaction. Each side mirrors through a single
// bot identity (bots get one reaction per message on Telegram, one react per
// key on WhatsApp), so concurrent reactors are last-writer-wins by design.
async function handleWaReactions(
	reactions: { key: proto.IMessageKey; reaction: proto.IReaction }[],
): Promise<void> {
	if (!db || !limiter || !tg) return

	for (const { key, reaction } of reactions) {
		try {
			// Skip our own TG→WA reacts echoing back (loop guard).
			if ((reaction as any)?.key?.fromMe) continue
			const targetId = key?.id
			const jid = key?.remoteJid
			if (!targetId || !jid || jid === 'status@broadcast') continue
			const mapping = db.getByJid(jid)
			if (!mapping || mapping.archived) continue
			// Unmapped targets (pre-bridge history, pruned) can't be quoted
			// by Telegram — nothing to attach the reaction to.
			const target = db.getByWaMsgId(targetId, jid)
			if (!target) continue

			const emoji = waReactionToTgEmoji(reaction?.text)
			const payload = emoji ? [{ type: 'emoji' as const, emoji }] : []
			await limiter.enqueue(() =>
				tg!.api.setMessageReaction(supergroupId, target.tg_msg_id, payload as any)
			)
		} catch (e) {
			console.error('[BRIDGE] failed to relay one WA reaction:', e)
		}
	}
}

// Normalize a WhatsApp reaction emoji for Telegram's allowed list, which
// uses the non-VS16 form (❤, not ❤️). Returns null for removals (empty
// text) so the caller clears the reaction instead.
export function waReactionToTgEmoji(text: string | null | undefined): string | null {
	if (!text) return null
	const clean = text.replace(/\uFE0F/g, '').trim()
	return clean || null
}

async function createForumTopic(displayName: string, _isGroup: boolean): Promise<number> {
	if (!tg) throw new Error('Telegram bot not initialized')
	const name = (displayName || 'Unknown').slice(0, 128) || 'Unknown'
	const topic = await tg.api.createForumTopic(supergroupId, name)
	return topic.message_thread_id
}

async function sendToTopic(
	topicId: number,
	label: string,
	text: string,
	media:
		| { kind: string; buffer: Uint8Array; mime?: string; fileName?: string; ptt?: boolean }
		| null,
	waJid: string,
	waMsg: proto.IWebMessageInfo,
	quote: { tgId: number | null; header: string | null },
): Promise<void> {
	if (!tg || !db) return
	// Native Telegram quote when the original was bridged. allow_sending_
	// without_reply keeps the send alive if that message was deleted since.
	const reply = quote.tgId
		? { reply_parameters: { message_id: quote.tgId, allow_sending_without_reply: true } }
		: undefined
	const body = `${quote.header ? quote.header + '\n' : ''}${label}${text}`

	if (!media) {
		const sent = await tg.api.sendMessage(supergroupId, body, {
			message_thread_id: topicId,
			...reply,
		})
		db.saveReplyMap(
			sent.message_id,
			waJid,
			waMsg.key?.id || '',
			JSON.stringify(waMsg.key || {}),
		)
		return
	}

	// Stickers take no caption: deliver an unmapped quote header as its own
	// message so the context still lands in the topic.
	if (media.kind === 'sticker' && quote.header && !quote.tgId) {
		await tg.api.sendMessage(supergroupId, quote.header, { message_thread_id: topicId })
	}

	const caption = body.length > 1024 ? undefined : (body || undefined)
	const file = new InputFile(media.buffer, media.fileName || `file.${extOf(media)}`)
	const thread = { message_thread_id: topicId } as const
	let sent: { message_id: number }

	switch (media.kind) {
		case 'image':
			sent = await tg.api.sendPhoto(supergroupId, file, { ...thread, caption, ...reply })
			break
		case 'video':
			sent = await tg.api.sendVideo(supergroupId, file, { ...thread, caption, ...reply })
			break
		case 'voice':
			sent = await tg.api.sendVoice(supergroupId, file, { ...thread, caption, ...reply })
			break
		case 'audio':
			sent = await tg.api.sendAudio(supergroupId, file, { ...thread, caption, ...reply })
			break
		case 'sticker':
			sent = await tg.api.sendSticker(supergroupId, file, {
				message_thread_id: topicId,
				...reply,
			})
			break
		default:
			sent = await tg.api.sendDocument(supergroupId, file, { ...thread, caption, ...reply })
			break
	}
	db.saveReplyMap(sent.message_id, waJid, waMsg.key?.id || '', JSON.stringify(waMsg.key || {}))

	// Captions are capped at 1024 chars — send the overflow as a follow-up.
	if (caption === undefined && body) {
		await tg.api.sendMessage(supergroupId, body, { message_thread_id: topicId })
	}
}

function extOf(media: { kind: string; mime?: string }): string {
	if (media.mime?.includes('/')) {
		const ext = media.mime.split('/')[1].split(';')[0].split('+')[0]
		if (ext && ext.length <= 5) return ext
	}
	switch (media.kind) {
		case 'image':
			return 'jpg'
		case 'video':
			return 'mp4'
		case 'voice':
		case 'audio':
			return 'ogg'
		case 'sticker':
			return 'webp'
		default:
			return 'bin'
	}
}

function getMsgText(message: proto.IMessage): string {
	for (const key of ['conversation', 'text', 'caption']) {
		const res = findKey(message, key)
		if (res) return String(res).trim()
	}
	return ''
}

interface WaQuote {
	stanzaId: string
	preview: string
	author: string
}

export type { WaQuote }

// Extract the WhatsApp quote (contextInfo) from an incoming message, if any.
// Reads contextInfo off the unwrapped top-level content node directly —
// never a deep search — so a nested quote-inside-a-quote can't be mistaken
// for the outer one. (findKey also skips quotedMessage subtrees, which is
// why getMsgText above returns the reply's own text, not the quoted text.)
export function getQuoteInfo(m: proto.IWebMessageInfo, fallbackAuthor: string): WaQuote | null {
	try {
		const raw = unwrap(m.message)
		if (!raw || typeof raw !== 'object') return null
		let ctx: any = null
		for (const value of Object.values(raw)) {
			if (value && typeof value === 'object' && (value as any).contextInfo?.stanzaId) {
				ctx = (value as any).contextInfo
				break
			}
		}
		if (!ctx) return null
		return {
			stanzaId: String(ctx.stanzaId),
			preview: describeQuoted(ctx.quotedMessage),
			author: ctx.participant ? phoneOf(ctx.participant) : fallbackAuthor,
		}
	} catch {
		return null
	}
}

// Short human-readable summary of the quoted original for the fallback
// header (used only when the original was never bridged to Telegram).
function describeQuoted(quotedMessage: any): string {
	if (quotedMessage && typeof quotedMessage === 'object') {
		const text = getMsgText(quotedMessage as proto.IMessage)
		if (text) return text.length > 200 ? text.slice(0, 200) + '…' : text
		const key = Object.keys(quotedMessage)[0] || ''
		if (key.includes('image')) return '📷 a photo'
		if (key.includes('video')) return '🎥 a video'
		if (key.includes('audio')) return '🎵 an audio message'
		if (key.includes('sticker')) return 'a sticker'
		if (key.includes('document')) return '📄 a document'
		if (key.includes('location')) return '📍 a location'
		if (key.includes('contact')) return '👤 a contact'
		if (key.includes('poll')) return '📊 a poll'
	}
	return 'a message'
}

interface WaMedia {
	kind: 'image' | 'video' | 'voice' | 'audio' | 'sticker' | 'document'
	buffer: Uint8Array
	mime?: string
	fileName?: string
	ptt?: boolean
}

async function downloadWaMedia(m: proto.IWebMessageInfo): Promise<WaMedia | null> {
	try {
		const raw = unwrap(m.message)
		if (!raw) return null

		let kind: WaMedia['kind'] | null = null
		let node: any = null
		if (raw.imageMessage) {
			kind = 'image'
			node = raw.imageMessage
		} else if (raw.videoMessage) {
			kind = 'video'
			node = raw.videoMessage
		} else if (raw.audioMessage) {
			kind = raw.audioMessage.ptt ? 'voice' : 'audio'
			node = raw.audioMessage
		} else if (raw.stickerMessage) {
			kind = 'sticker'
			node = raw.stickerMessage
		} else if (raw.documentMessage) {
			kind = 'document'
			node = raw.documentMessage
		} else {
			return null
		}
		if (!node?.url && !node?.directPath) return null

		const buffer = await downloadMediaMessage(
			m as any,
			'buffer',
			{},
			{ reuploadRequest: bot.sock.updateMediaMessage, logger },
		).catch(() => null) as Buffer | Uint8Array | null
		if (!buffer) return null

		return {
			kind,
			buffer: new Uint8Array(buffer),
			mime: node.mimetype,
			fileName: node.fileName,
			ptt: node.ptt,
		}
	} catch {
		return null
	}
}

// Peel view-once / ephemeral wrappers so media underneath is reachable.
function unwrap(message: proto.IMessage | undefined | null): any {
	let node: any = message
	for (let i = 0; i < 4 && node; i++) {
		if (node.viewOnceMessageV2) node = node.viewOnceMessageV2.message
		else if (node.viewOnceMessage) node = node.viewOnceMessage.message
		else if (node.ephemeralMessage) node = node.ephemeralMessage.message
		else if (node.documentWithCaptionMessage) node = node.documentWithCaptionMessage.message
		else break
	}
	return node
}
