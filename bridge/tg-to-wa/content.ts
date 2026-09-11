// WhatsApp content builders - media mapping plus quote and reaction helpers.
// Hyphen-only header - plain ASCII dashes for all punctuation.
import { convertWebmToStickerWebp } from './replies.ts'
import type { BridgeDB } from '../db.ts'

export async function buildWaContent(
	text: string,
	media: { kind: string; buffer: Uint8Array; fileName?: string; mime?: string } | null,
	msg: any,
): Promise<any> {
	if (msg.location) {
		const { latitude, longitude } = msg.location
		return {
			location: { degreesLatitude: latitude, degreesLongitude: longitude },
		}
	}
	if (msg.contact) {
		const c = msg.contact
		return {
			text: `Contact: ${c.first_name || ''} ${c.last_name || ''} ${c.phone_number || ''}`
				.trim(),
		}
	}
	if (msg.poll) {
		const p = msg.poll
		const values = tgPollOptions(msg)
		if (!values) {
			const opts = (p.options || []).map((o: any) => `- ${o?.text}`).join('\n')
			const fallback = `${text ? text + '\n' : ''}Poll: ${p.question}\n${opts}`.trim()
			return fallback ? { text: fallback } : null
		}
		// Quiz mode has no WhatsApp equivalent - the correct answer is
		// dropped and the quiz travels as a regular poll.
		return {
			poll: {
				name: String(p.question || 'Poll').slice(0, 255),
				values,
				selectableCount: p.allows_multiple_answers ? values.length : 1,
			},
		}
	}
	if (!media) return text ? { text } : null
	// Baileys' getStream() only accepts Buffer | { stream } | { url }. A raw
	// Deno/Telegram Uint8Array falls through to `item.url.toString()` and
	// crashes with "Cannot read properties of undefined (reading 'toString')",
	// so convert every buffer to a Node Buffer first.
	const buf = Buffer.from(media.buffer)
	switch (media.kind) {
		case 'image':
			return { image: buf, caption: text || undefined }
		case 'video':
			return { video: buf, caption: text || undefined, mimetype: media.mime || 'video/mp4' }
		case 'video_note':
			// Round video messages: Baileys turns { video, ptv: true } into a
			// ptvMessage the WA clients render as a round bubble.
			return { video: buf, ptv: true, mimetype: 'video/mp4' }
		case 'gif':
			// Telegram animations are GIFs; gifPlayback renders them as such
			// on WhatsApp (ignored by clients that don't know the flag, in
			// which case it just plays as video - same as before).
			return {
				video: buf,
				gifPlayback: true,
				caption: text || undefined,
				mimetype: media.mime || 'video/mp4',
			}
		case 'voice':
			return { audio: buf, ptt: true, mimetype: 'audio/ogg; codecs=opus' }
		case 'audio':
			return { audio: buf, mimetype: media.mime || 'audio/mpeg' }
		case 'sticker':
			// WhatsApp stickers must be WebP. Telegram animated (.tgs, Lottie)
			// stickers can't be rendered by ffmpeg, so they still relay as a
			// document. Video (.webm) stickers are transcoded to animated
			// WebP first, falling back to video when conversion fails.
			if (media.mime === 'video/webm' || (media.fileName || '').endsWith('.webm')) {
				const webp = await convertWebmToStickerWebp(media.buffer).catch(() => null)
				if (webp) return { sticker: Buffer.from(webp) }
				return { video: buf, caption: text || undefined }
			}
			if (media.mime?.includes('tgs') || (media.fileName || '').endsWith('.tgs')) {
				return {
					document: buf,
					fileName: media.fileName || 'sticker.tgs',
					mimetype: media.mime || 'application/octet-stream',
					caption: text || undefined,
				}
			}
			return { sticker: buf }
		default:
			return {
				document: buf,
				fileName: media.fileName || 'file',
				mimetype: media.mime || 'application/octet-stream',
				caption: text || undefined,
			}
	}
}

// Ordered option texts of a Telegram poll, or null when unusable (fewer
// than 2 non-blank options). Shared by the WA poll builder below and the
// vote-metadata stored after the send.
export function tgPollOptions(msg: any): string[] | null {
	const opts = (msg?.poll?.options || [])
		.map((o: any) => String(o?.text || '').trim())
		.filter((o: string) => o.length > 0)
		.slice(0, 12)
	return opts.length >= 2 ? opts : null
}

// Rebuild the Baileys key of the WA message a Telegram message mirrors.
// Current rows carry the full key JSON; legacy rows stored '{}' - those are
// always TG-originated sends (fromMe), so the key can be synthesized.
export function restoreWaKey(
	entry: { wa_jid: string; wa_msg_id: string; wa_key_json: string },
): any {
	try {
		const key = JSON.parse(entry.wa_key_json)
		if (key?.id) return key
	} catch {
		// fall through to synthesis
	}
	if (entry.wa_msg_id) {
		return { remoteJid: entry.wa_jid, id: entry.wa_msg_id, fromMe: true }
	}
	return null
}

// Pick the WhatsApp reaction text for a Telegram reaction change. Empty
// string = removal. Custom-emoji and paid reactions have no WhatsApp
// equivalent, so they fall back to heart (logged by the caller path).
export function tgReactionToWaEmoji(oldList: any[], newList: any[]): string {
	const oldR = oldList || []
	const newR = newList || []
	if (newR.length === 0) return ''
	const same = (a: any, b: any) =>
		a?.type === b?.type && (a?.emoji || a?.custom_emoji_id) === (b?.emoji || b?.custom_emoji_id)
	const fresh = newR.filter((r: any) => !oldR.some((o: any) => same(o, r)))
	const pool = fresh.length > 0 ? fresh : newR
	const std = pool.find((r: any) => r?.type === 'emoji' && r?.emoji)
	if (std) return String(std.emoji)
	return '❤️'
}

// Telegram reply -> WhatsApp quoted reply. The reply_map tells us which WA
// message the replied-to Telegram message mirrors. Baileys accepts a minimal
// quoted stub ({key, message}) when the full original is unavailable.
export function buildQuoted(msg: any, waJid: string, db: BridgeDB, chatId: string): any {
	const repliedId = msg.reply_to_message?.message_id
	if (!repliedId) return null
	try {
		const entry = db.getReplyMapAt(chatId, repliedId)
		if (!entry) return null
		let key: any = null
		try {
			key = JSON.parse(entry.wa_key_json)
		} catch {
			key = null
		}
		if (!key?.id) {
			key = { remoteJid: waJid, id: entry.wa_msg_id, fromMe: false }
		}
		const origText = msg.reply_to_message?.text || msg.reply_to_message?.caption || ''
		return { key, message: { conversation: origText.slice(0, 500) || '...' } }
	} catch {
		return null
	}
}
