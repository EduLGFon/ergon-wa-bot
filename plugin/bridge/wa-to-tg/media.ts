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
// capped at 2 simultaneous downloads for the same reason.
import { downloadMediaMessage, type proto } from 'baileys'
import { waBytes } from './media-utils.ts'
import { logger } from '@util/proto.ts'
import { unwrap } from './text.ts'
import bot from '@plugin/bot.ts'

export const WA_DOWNLOAD_CAP_BYTES = 50_000_000
const MAX_CONCURRENT_DOWNLOADS = 2
const DOWNLOAD_ATTEMPTS = 3
const RETRY_BASE_MS = 500
const RETRY_MAX_MS = 4000
const RETRY_JITTER_MS = 250
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

// True for stale/expired media keys: OpenSSL rejects the decrypt
// deterministically (code ERR_OSSL_EVP_BAD_DECRYPT, message "bad decrypt").
// Retrying or refreshing the URL never helps, so these skip the retry loop
// and the transient-failure counter straight to the skip notice.
function isBadDecrypt(e: unknown): boolean {
	try {
		const rec = (e && typeof e === 'object' ? e : {}) as Record<string, unknown>
		const cause = rec.cause as Record<string, unknown> | undefined
		const text = [rec.code, rec.name, rec.message, cause?.code, cause?.message]
			.filter((p) => typeof p === 'string').join(' ').toLowerCase()
		return text.includes('bad_decrypt') || text.includes('bad decrypt')
	} catch {
		return false
	}
}

export async function downloadWaMedia(m: proto.IWebMessageInfo): Promise<WaDownload | null> {
	try {
		let raw = unwrap(m.message)
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
		let refreshedOnce = false
		try {
			// Sticker URLs in particular expire quickly; one transient fetch
			// failure used to lose the media permanently. Retry bounded times
			// with exponential backoff plus jitter before reporting it, so a
			// CDN outage does not retry in lockstep. On the first transient
			// failure, ask Baileys to refresh the media URL and retry the
			// full download. Stale keys (bad decrypt) fail permanently - no
			// refresh, no retry.
			for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt++) {
				try {
					buffer = await downloadMediaMessage(
						{ ...m, message: raw } as any,
						'buffer',
						{},
						{ reuploadRequest: bot.sock.updateMediaMessage, logger },
					) as Buffer | Uint8Array | null
					if (buffer) break
				} catch (e) {
					dlErr = e
					if (isBadDecrypt(e)) break
					if (!refreshedOnce) {
						refreshedOnce = true
						try {
							const updated = await bot.sock.updateMediaMessage?.(m as any)
							if (updated) {
								m = updated
								const newRaw = unwrap((m as any).message)
								if (newRaw) raw = newRaw
							}
						} catch {
							// best effort refresh; retry anyway
						}
					}
				}
				if (buffer || attempt >= DOWNLOAD_ATTEMPTS || isBadDecrypt(dlErr)) break
				const baseMs = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (attempt - 1))
				await new Promise((r) => setTimeout(r, baseMs + Math.random() * RETRY_JITTER_MS))
			}
		} finally {
			inflightDownloads = Math.max(0, inflightDownloads - 1)
		}
		if (!buffer) {
			// Permanent (stale media key): skip straight to the notice path
			// with a clear line. Retrying never helps and these must not
			// inflate the transient __waDlFail HEALTH counter.
			const permanent = isBadDecrypt(dlErr)
			// Small files (stickers of a few KB) land here when the media URL
			// expired or the reupload request failed - log the cause so the
			// generic topic notice can be triaged from server logs. URLs and
			// direct paths never hit the log (identifiers), only booleans.
			const errName = dlErr instanceof Error
				? dlErr.name
				: typeof dlErr === 'object' && dlErr !== null
				? String((dlErr as { name?: unknown }).name ?? '')
				: ''
			const errCode = dlErr && typeof dlErr === 'object'
				? String((dlErr as { code?: unknown }).code ?? '')
				: ''
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
			if (!permanent) {
				try {
					;(globalThis as any).__waDlFail = ((globalThis as any).__waDlFail || 0) + 1
				} catch {
					// ignore
				}
			}
			console.warn(
				permanent
					? `[BRIDGE] WA download skipped: ${label} bytes=${
						bytes ?? '?'
					} stale key (bad decrypt)`
					: `[BRIDGE] WA download failed: ${label} bytes=${bytes ?? '?'} hasUrl=${!!node
						?.url} hasDirectPath=${!!node?.directPath}${
						errName ? ` name=${errName}` : ''
					}${errCode ? ` code=${errCode}` : ''}${
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
