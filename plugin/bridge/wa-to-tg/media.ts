// WhatsApp media download - fetch attachments off the shared socket.
//
// Media nodes carry only metadata until downloaded - this resolves the node
// kind, guards missing urls and returns buffers plus failure labels so the
// caller can notify the topic instead of dropping silently.
//
// Memory note: downloadMediaMessage buffers the whole file in RAM. Large
// videos spike RSS (5GB spike in prod logs). WA_DOWNLOAD_CAP_BYTES caps at
// 50MB (Telegram cloud Bot API send limit is 50MB) with a fileLength
// pre-check so huge files fail fast without ever allocating. Concurrency is
// capped at 3 simultaneous downloads for the same reason.
import { downloadMediaMessage, type proto } from 'baileys'
import { waBytes } from './media-utils.ts'
import { logger } from '@util/proto.ts'
import { unwrap } from './text.ts'
import bot from '@plugin/bot.ts'

export const WA_DOWNLOAD_CAP_BYTES = 50_000_000
const MAX_CONCURRENT_DOWNLOADS = 2
const DOWNLOAD_ATTEMPTS = 3
let inflightDownloads = 0

export interface WaMedia {
	kind: 'image' | 'video' | 'round' | 'gif' | 'voice' | 'audio' | 'sticker' | 'document'
	buffer: Uint8Array
	mime?: string
	fileName?: string
	ptt?: boolean
}

// Result of attempting a WhatsApp attachment download. null = the message
// carries no media node at all; otherwise media is set on success and null
// on failure, with label/bytes describing what didn't cross (from the
// node's fileLength, which Baileys exposes as number | Long | string) and
// tooLarge marking cap pre-check (or oversize actual buffer) skips.
export interface WaDownload {
	media: WaMedia | null
	label: string
	bytes: number | null
	tooLarge: boolean
}

export async function downloadWaMedia(m: proto.IWebMessageInfo): Promise<WaDownload | null> {
	try {
		const raw = unwrap(m.message)
		if (!raw) return null

		let kind: WaMedia['kind'] | null = null
		let label = 'attachment'
		let node: any = null
		if (raw.imageMessage) {
			kind = 'image'
			label = 'image'
			node = raw.imageMessage
		} else if (raw.ptvMessage) {
			// Round video-note messages arrive as ptvMessage, not videoMessage.
			kind = 'round'
			label = 'video note'
			node = raw.ptvMessage
		} else if (raw.videoMessage) {
			// GIFs are videoMessages with the gifPlayback flag.
			const isGif = !!raw.videoMessage.gifPlayback
			kind = isGif ? 'gif' : 'video'
			label = isGif ? 'GIF' : 'video'
			node = raw.videoMessage
		} else if (raw.audioMessage) {
			const isVoice = !!raw.audioMessage.ptt
			kind = isVoice ? 'voice' : 'audio'
			label = isVoice ? 'voice message' : 'audio'
			node = raw.audioMessage
		} else if (raw.stickerMessage) {
			kind = 'sticker'
			label = 'sticker'
			node = raw.stickerMessage
		} else if (raw.documentMessage) {
			kind = 'document'
			label = documentLabel(raw.documentMessage)
			node = raw.documentMessage
		} else {
			return null
		}
		const bytes = waBytes(node?.fileLength)
		const fail = (tooLarge = false): WaDownload => ({ media: null, label, bytes, tooLarge })
		if (!node?.url && !node?.directPath) {
			console.warn(`[BRIDGE] WA download no-url: ${label} bytes=${bytes ?? '?'}`)
			return fail(false)
		}
		// Fail fast on declared size: a 200MB video must not allocate RAM.
		if (bytes != null && bytes > WA_DOWNLOAD_CAP_BYTES) return fail(true)

		// Cap concurrent full-file buffers: a burst of videos would otherwise
		// stack multiple 50MB buffers in RAM at once.
		while (inflightDownloads >= MAX_CONCURRENT_DOWNLOADS) {
			await new Promise((r) => setTimeout(r, 200))
		}
		inflightDownloads++
		let buffer: Buffer | Uint8Array | null = null
		let dlErr: unknown = null
		try {
			// Sticker URLs in particular expire quickly; one transient fetch
			// failure used to lose the media permanently. Retry a couple of
			// times with a short backoff before reporting it.
			for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt++) {
				try {
					buffer = await downloadMediaMessage(
						m as any,
						'buffer',
						{},
						{ reuploadRequest: bot.sock.updateMediaMessage, logger },
					) as Buffer | Uint8Array | null
					if (buffer) break
				} catch (e) {
					dlErr = e
				}
				if (attempt < DOWNLOAD_ATTEMPTS) {
					await new Promise((r) => setTimeout(r, attempt * 500))
				}
			}
		} finally {
			inflightDownloads = Math.max(0, inflightDownloads - 1)
		}
		if (!buffer) {
			// Small files (stickers of a few KB) land here when the media URL
			// expired or the reupload request failed - log the cause so the
			// generic topic notice can be triaged from server logs.
			const errMsg = dlErr instanceof Error
				? dlErr.message
				: typeof dlErr === 'object' && dlErr !== null
				? String((dlErr as { message?: unknown }).message ?? dlErr)
				: ''
			const cause = dlErr && typeof dlErr === 'object'
				? (dlErr as { cause?: { code?: unknown; errno?: unknown; message?: unknown } })
					.cause
				: undefined
			const causeMsg = cause ? String(cause.code ?? cause.errno ?? cause.message ?? '') : ''
			console.warn(
				`[BRIDGE] WA download failed: ${label} bytes=${bytes ?? '?'} hasUrl=${!!node
					?.url} hasDirectPath=${!!node?.directPath}${
					errMsg ? ` err=${String(errMsg).slice(0, 160)}` : ''
				}${causeMsg ? ` cause=${causeMsg.slice(0, 120)}` : ''}`,
			)
			return fail(false)
		}
		// Double-check actual size: declared fileLength can lie.
		if ((buffer as Uint8Array).length > WA_DOWNLOAD_CAP_BYTES) {
			return fail(true)
		}

		return {
			media: {
				kind,
				buffer,
				mime: node.mimetype,
				fileName: node.fileName,
				ptt: node.ptt,
			},
			label,
			bytes,
			tooLarge: false,
		}
	} catch {
		return null
	}
}

export function documentLabel(node: any): string {
	return node?.fileName ? `document "${node.fileName}"` : 'document'
}
