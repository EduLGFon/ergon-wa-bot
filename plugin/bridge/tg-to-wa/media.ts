// Telegram media download - Bot API fetch with 20 MB cap.
// Hyphen-only header - plain ASCII dashes for all punctuation.
import { Bot } from 'grammy'

export interface TgMedia {
	kind: 'image' | 'video' | 'video_note' | 'gif' | 'voice' | 'audio' | 'sticker' | 'document'
	buffer: Uint8Array
	fileName?: string
	mime?: string
}

// Bot API getFile refuses files over 20 MB ("file is too big") -
// pre-check file_size so doomed downloads fail fast with a specific
// notice instead of a generic one after a wasted attempt.
export const TG_DOWNLOAD_CAP_BYTES = 20_000_000

// Result of attempting a Telegram attachment download. null = the message
// carries no attachment node at all; otherwise media is set on success and
// null on failure, with label/bytes describing what didn't cross and
// tooLarge marking cap pre-check (or getFile "too big") skips.
export interface TgDownload {
	media: TgMedia | null
	label: string
	bytes: number | null
	tooLarge: boolean
}

export function tgBytes(v: unknown): number | null {
	if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v
	return null
}

export async function downloadTgMedia(tg: Bot, msg: any): Promise<TgDownload | null> {
	try {
		let fileId: string | null = null
		let kind: TgMedia['kind'] = 'document'
		let label = 'attachment'
		let bytes: number | null = null
		let fileName: string | undefined
		let mime: string | undefined
		if (msg.sticker) {
			fileId = fileIdOf(msg.sticker)
			kind = 'sticker'
			label = 'sticker'
			bytes = tgBytes(msg.sticker.file_size)
			// WhatsApp only accepts WebP stickers. Flag video (.webm) and
			// animated (.tgs) ones here so buildWaContent() can relay them
			// as video/document instead.
			if (msg.sticker.is_video) {
				fileName = 'sticker.webm'
				mime = 'video/webm'
			} else if (msg.sticker.is_animated) {
				fileName = 'sticker.tgs'
				mime = 'application/x-tgs'
			} else {
				fileName = 'sticker.webp'
				mime = 'image/webp'
			}
		} else if (msg.photo?.length) {
			const best = msg.photo[msg.photo.length - 1]
			fileId = fileIdOf(best)
			kind = 'image'
			label = 'image'
			bytes = tgBytes(best.file_size)
		} else if (msg.video) {
			fileId = fileIdOf(msg.video)
			kind = 'video'
			label = 'video'
			bytes = tgBytes(msg.video.file_size)
			fileName = msg.video.file_name
			mime = msg.video.mime_type
		} else if (msg.video_note) {
			fileId = fileIdOf(msg.video_note)
			kind = 'video_note'
			label = 'video note'
			bytes = tgBytes(msg.video_note.file_size)
		} else if (msg.animation) {
			fileId = fileIdOf(msg.animation)
			kind = 'gif'
			label = 'GIF'
			bytes = tgBytes(msg.animation.file_size)
			fileName = msg.animation.file_name
			mime = msg.animation.mime_type
		} else if (msg.voice) {
			fileId = fileIdOf(msg.voice)
			kind = 'voice'
			label = 'voice message'
			bytes = tgBytes(msg.voice.file_size)
		} else if (msg.audio) {
			fileId = fileIdOf(msg.audio)
			kind = 'audio'
			label = 'audio'
			bytes = tgBytes(msg.audio.file_size)
			mime = msg.audio.mime_type
		} else if (msg.document) {
			fileId = fileIdOf(msg.document)
			kind = 'document'
			label = msg.document.file_name ? `document "${msg.document.file_name}"` : 'document'
			bytes = tgBytes(msg.document.file_size)
			fileName = msg.document.file_name
			mime = msg.document.mime_type
		} else {
			return null
		}
		const fail = (tooLarge: boolean): TgDownload => ({ media: null, label, bytes, tooLarge })
		if (bytes != null && bytes > TG_DOWNLOAD_CAP_BYTES) return fail(true)
		if (!fileId) return fail(false)
		const buffer = await downloadTgFile(tg, fileId)
		if (buffer === 'too-large') return fail(true)
		if (!buffer) return fail(false)
		return { media: { kind, buffer, fileName, mime }, label, bytes, tooLarge: false }
	} catch {
		return null
	}
}

export function fileIdOf(f: any): string | null {
	if (!f) return null
	if (typeof f === 'string') return f
	if (typeof f.file_id === 'string') return f.file_id
	return null
}

export async function downloadTgFile(
	tg: Bot,
	fileId: string,
): Promise<Uint8Array | 'too-large' | null> {
	try {
		const token = Deno.env.get('TELEGRAM_BOT_TOKEN')!
		const file = await tg.api.getFile(fileId)
		if (!file.file_path) return null
		const res = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`)
		if (!res.ok) return null
		const declared = Number(res.headers.get('content-length'))
		if (Number.isFinite(declared) && declared > TG_DOWNLOAD_CAP_BYTES) {
			await res.body?.cancel().catch(() => {})
			return 'too-large'
		}
		const buf = new Uint8Array(await res.arrayBuffer())
		if (buf.length > TG_DOWNLOAD_CAP_BYTES) return 'too-large'
		return buf
	} catch (e) {
		// Second layer behind the file_size pre-check (size can be absent
		// on some nodes): getFile itself refuses >20 MB files.
		const msg = (e as { description?: unknown; message?: unknown })?.description ??
			(e as { message?: unknown })?.message ?? ''
		if (/too big|too large|file_too_big/i.test(String(msg))) return 'too-large'
		return null
	}
}
