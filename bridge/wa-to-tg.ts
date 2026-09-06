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

			const label = isGroup ? `${senderName}: ` : ''
			await limiter.enqueue(() => sendToTopic(topicId, label, text, media, jid, m))
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
): Promise<void> {
	if (!tg || !db) return
	const fullText = `${label}${text}`

	if (!media) {
		const sent = await tg.api.sendMessage(supergroupId, fullText, {
			message_thread_id: topicId,
		})
		db.saveReplyMap(
			sent.message_id,
			waJid,
			waMsg.key?.id || '',
			JSON.stringify(waMsg.key || {}),
		)
		return
	}

	const caption = fullText.length > 1024 ? undefined : (fullText || undefined)
	const file = new InputFile(media.buffer, media.fileName || `file.${extOf(media)}`)
	const thread = { message_thread_id: topicId } as const
	let sent: { message_id: number }

	switch (media.kind) {
		case 'image':
			sent = await tg.api.sendPhoto(supergroupId, file, { ...thread, caption })
			break
		case 'video':
			sent = await tg.api.sendVideo(supergroupId, file, { ...thread, caption })
			break
		case 'voice':
			sent = await tg.api.sendVoice(supergroupId, file, { ...thread, caption })
			break
		case 'audio':
			sent = await tg.api.sendAudio(supergroupId, file, { ...thread, caption })
			break
		case 'sticker':
			sent = await tg.api.sendSticker(supergroupId, file, { message_thread_id: topicId })
			break
		default:
			sent = await tg.api.sendDocument(supergroupId, file, { ...thread, caption })
			break
	}
	db.saveReplyMap(sent.message_id, waJid, waMsg.key?.id || '', JSON.stringify(waMsg.key || {}))

	// Captions are capped at 1024 chars — send the overflow as a follow-up.
	if (caption === undefined && fullText) {
		await tg.api.sendMessage(supergroupId, fullText, { message_thread_id: topicId })
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
