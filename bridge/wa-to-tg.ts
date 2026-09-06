import {
	Browsers,
	downloadMediaMessage,
	makeWASocket,
	type proto,
	useMultiFileAuthState,
} from 'baileys'
import { makeCacheableSignalKeyStore } from 'baileys'
import { BridgeDB, type MappingRow } from './db.ts'
import { RateLimiter } from './rate-limiter.ts'
import { Bot } from 'grammy'

export let waSock: ReturnType<typeof makeWASocket> | null = null
let botInstance: Bot | null = null
let dbInstance: BridgeDB | null = null
let rateLimiterInstance: RateLimiter | null = null

async function initWhatsAppConnection() {
	try {
		const { state, saveCreds } = await useMultiFileAuthState('../conf/gen/auth')

		console.log('[WA] Auth loaded, connecting...')

		waSock = makeWASocket({
			auth: {
				creds: state.creds,
				keys: makeCacheableSignalKeyStore(state.keys, { level: 'silent' } as any),
			},
			logger: { level: 'info' } as any,
			markOnlineOnConnect: false,
			browser: Browsers.macOS('Desktop'),
			syncFullHistory: false,
			version: [2, 3000, 1044006379],
			shouldSyncHistoryMessage: () => false,
		})

		waSock.ev.on('creds.update', saveCreds)

		waSock.ev.on('messages.upsert', async (raw: { messages: proto.IWebMessageInfo[] }) => {
			await handleWAMessages(raw.messages)
		})

		console.log('[WA] Connecting to WhatsApp...')
		await (waSock as any).connect()
		console.log('[WA] Connected!')
	} catch (e) {
		console.error('[WA] Connection failed:', e)
		console.error('[WA] Make sure the WhatsApp bot is logged in and conf/gen/auth exists')
		console.error(
			'[WA] If using PostgreSQL auth, copy session from main bot or run: deno task reset',
		)
	}
}

async function handleWAMessages(messages: proto.IWebMessageInfo[]) {
	if (!dbInstance || !rateLimiterInstance || !botInstance) return

	for (const m of messages) {
		if (!m?.message || !m.key || m.key.fromMe) continue

		const jid = m.key.remoteJid!
		if (!jid) continue
		const isGroup = jid.includes('@g.us')
		const participant = m.key.participant || jid
		const displayName = m.pushName || participant.split(':')[0] || ''
		const chatType: '1:1' | 'group' = isGroup ? 'group' : '1:1'

		let mapping = dbInstance.getByJid(jid)

		if (!mapping || mapping.archived) {
			const topicId = await createForumTopic(displayName, isGroup)
			mapping = dbInstance.getOrCreate(jid, topicId, displayName, chatType)
		} else {
			dbInstance.updateLastActive(jid)
		}

		const text = getMsgText(m.message)
		const media = await downloadMedia(m)

		if (!text && !media) continue

		await rateLimiterInstance.enqueue(async () => {
			await sendToTelegram(mapping!, text, media, isGroup)
		}, mapping!.telegram_topic_id)
	}
}

async function createForumTopic(displayName: string, isGroup: boolean): Promise<number> {
	if (!botInstance) throw new Error('Bot not initialized')
	const name = isGroup ? displayName : `WA: ${displayName || 'Unknown'}`
	const tgChatId = Deno.env.get('TELEGRAM_SUPERGROUP_ID')!
	const result = await botInstance.api.createForumTopic(tgChatId, name.slice(0, 255))
	return result.message_thread_id
}

async function sendToTelegram(
	mapping: MappingRow,
	text: string,
	media: { type: string; buffer: Uint8Array } | null,
	isGroup: boolean,
) {
	if (!botInstance) return

	let content: any = {}

	if (media) {
		content = mediaToTelegramContent(media)
	}

	if (text) {
		content = { ...content, text: isGroup ? `*${mapping.display_name}*: ${text}` : text }
	}

	if (Object.keys(content).length === 0) return

	await botInstance.api.sendMessage(Deno.env.get('TELEGRAM_SUPERGROUP_ID')!, content, {
		message_thread_id: mapping.telegram_topic_id,
	})
}

function mediaToTelegramContent(media: { type: string; buffer: Uint8Array }): any {
	switch (media.type) {
		case 'image':
			return { photo: media.buffer }
		case 'video':
			return { video: media.buffer }
		case 'audio':
			return { audio: media.buffer }
		case 'sticker':
			return { sticker: media.buffer }
		case 'document':
			return { document: media.buffer }
		case 'voice':
			return { voice: media.buffer }
		default:
			return { document: media.buffer }
	}
}

function getMsgText(message: proto.IMessage | undefined): string {
	if (!message) return ''
	for (const key of ['conversation', 'text', 'caption']) {
		const msg = (message as any)[key]
		if (msg) return String(msg).trim()
	}
	return ''
}

async function downloadMedia(
	m: proto.IWebMessageInfo,
): Promise<{ type: string; buffer: Uint8Array } | null> {
	try {
		if (!m.message || !m.key) return null
		const wamessage = m.message as any
		const types = [
			'conversation',
			'text',
			'extendedTextMessage',
			'imageMessage',
			'videoMessage',
			'audioMessage',
			'stickerMessage',
			'documentMessage',
			'ptvMessage',
			'viewOnceMessageV2',
		]
		for (const t of types) {
			const segment = (wamessage as any)[t]
			if (segment && (segment as any).url) {
				const buffer = await downloadMediaMessage(wamessage, 'buffer', {}, {
					reuploadRequest: (waSock as any).updateMediaMessage,
					logger: { level: 'silent' } as any,
				})
				if (buffer) {
					let type = 'document'
					if (t.includes('image')) type = 'image'
					else if (t.includes('video')) type = 'video'
					else if (t.includes('audio')) type = 'audio'
					else if (t.includes('sticker')) type = 'sticker'
					else if (t.includes('document')) type = 'document'
					return { type, buffer: new Uint8Array(buffer) }
				}
			}
		}
	} catch {
		// ignore media download errors
	}
	return null
}

export async function start(
	db: BridgeDB,
	rateLimiter: RateLimiter,
	bot: Bot,
) {
	dbInstance = db
	rateLimiterInstance = rateLimiter
	botInstance = bot

	await initWhatsAppConnection()
}

export function stop() {
	if (waSock) {
		;(waSock as any).ws.close()
		waSock = null
	}
	dbInstance = null
	rateLimiterInstance = null
	botInstance = null
}
