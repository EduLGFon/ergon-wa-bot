// Album eligibility and pending state - groups photo bursts in one place.
//
// Consecutive photos/videos from the same sender cross as one Telegram media
// group instead of N singles - this holds the pending buffers and the
// eligibility check so the flush worker stays small and focused.
import type { WaSpecial } from './special.ts'
import type { TgEntity } from '../format.ts'
import type { proto } from 'baileys'

export const ALBUM_WINDOW_MS = 1500
export const MAX_ALBUM_ITEMS = 10

export interface AlbumItem {
	m: proto.IWebMessageInfo
	topicId: number
	chatId: string
	body: string
	entities: TgEntity[]
	media: { kind: string; buffer: Uint8Array; mime?: string; fileName?: string; ptt?: boolean }
	replyToTgId: number | null
}

export const pendingAlbums = new Map<
	string,
	{ items: AlbumItem[]; timer: ReturnType<typeof setTimeout> }
>()

export function albumKey(jid: string, m: proto.IWebMessageInfo): string {
	const sender = m.key?.fromMe ? 'me' : (m.key?.participant || m.pushName || 'other')
	return `${jid}\n${sender}`
}

export function isAlbumEligible(
	media:
		| { kind: string; buffer: Uint8Array; mime?: string; fileName?: string; ptt?: boolean }
		| null,
	special: WaSpecial | null,
	body: string,
): media is AlbumItem['media'] {
	return !!media &&
		(media.kind === 'image' || media.kind === 'video' || media.kind === 'gif') &&
		!special && body.length <= 1024
}
