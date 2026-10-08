// Media mirror helpers - sizes, extensions and stored snapshots in one place.
//
// Downloads advertise sizes as number/Long/string and Telegram caps captions
// at 1024 chars - these pure helpers normalize bytes, extensions and the
// capped snapshots that later let revokes re-edit mirrors into spoilers.
import type { TgEntity } from '../format.ts'
import { formatBytes } from '../format.ts'

// Cap mirror content stored for revoke-as-spoiler - enough for a tombstone,
// small enough to keep reply_map lean.
export const STORED_TEXT_MAX = 1500

export function storedText(body: string): string | null {
	if (!body) return null
	return body.length > STORED_TEXT_MAX ? body.slice(0, STORED_TEXT_MAX) : body
}

export function storedEntities(entities: TgEntity[]): string | null {
	if (!entities || entities.length === 0) return null
	try {
		return JSON.stringify(entities)
	} catch {
		return null
	}
}

export function extOf(media: { kind: string; mime?: string }): string {
	if (media.mime?.includes('/')) {
		const ext = media.mime.split('/')[1].split(';')[0].split('+')[0]
		if (ext && ext.length <= 5) return ext
	}
	switch (media.kind) {
		case 'image':
			return 'jpg'
		case 'video':
		case 'round':
		case 'gif':
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

// Normalize a Baileys fileLength (number | numeric string | Long-like
// {low,high} | bigint) to bytes. Anything unparseable -> null (the notice
// just omits the size rather than printing garbage).
export function waBytes(v: unknown): number | null {
	try {
		if (typeof v === 'number') {
			return Number.isFinite(v) && v >= 0 ? Math.floor(v) : null
		}
		if (typeof v === 'string') {
			const n = Number(v)
			return v.trim() !== '' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : null
		}
		if (typeof v === 'bigint') {
			return v >= 0 && v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : null
		}
		if (typeof v === 'object' && v !== null) {
			const { low, high } = v as { low?: unknown; high?: unknown }
			if (typeof low === 'number' && typeof high === 'number') {
				const n = high * 2 ** 32 + (low >>> 0)
				return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null
			}
		}
	} catch {
		// fall through to null
	}
	return null
}

// Topic notice for a failed WhatsApp download: names the attachment kind
// (documents include the file name) and size when known. Article keys off
// "WhatsApp" (consonant), not the label.
export function waDownloadFailureLine(label: string, bytes: number | null): string {
	const size = bytes != null ? ` (${formatBytes(bytes)})` : ''
	return `⚠️ Couldn't download a WhatsApp ${label}${size} - it didn't cross.`
}
