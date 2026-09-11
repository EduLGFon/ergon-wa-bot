// Prepared-send dispatch - body assembly and album-or-direct routing.
//
// Split from incoming.ts so the upsert loop stays under the file budget:
// quote resolution, sender label + entity offsets, sticker fallback header,
// album buffering vs immediate send, then the classification prompt.
import { bufferAlbumItem, flushPendingAlbums } from './album-flush.ts'
import { maybePromptClassification } from './prompt.ts'
import { type TgEntity, waMarkdownToTgEntities } from '../format.ts'
import { resolveQuoteTarget } from './quote.ts'
import { isAlbumEligible } from './album.ts'
import type { OwnerMentionSpan } from './text.ts'
import type { WaSpecial } from './special.ts'
import type { AlbumItem } from './album.ts'
import type { BridgeDB } from '../db.ts'
import { relayCtx } from './state.ts'
import { sendToTopic } from './send.ts'
import type { proto } from 'baileys'

export interface PreparedDispatch {
	db: BridgeDB
	jid: string
	aliases: string[]
	m: proto.IWebMessageInfo
	chatId: string
	topicId: number
	displayName: string
	senderName: string
	fromMe: boolean
	isGroup: boolean
	text: string
	ownerSpans: OwnerMentionSpan[]
	media: AlbumItem['media'] | null
	special: WaSpecial | null
}

// Owner @token spans -> Telegram text_mention entities so @all and direct
// mentions actually notify. The owner identity is resolved once at boot;
// without it the spans stay plain text.
export function ownerMentionEntities(
	spans: OwnerMentionSpan[],
	shift: number,
): TgEntity[] {
	const owner = relayCtx.ownerTg
	if (!owner || !spans || spans.length === 0) return []
	return spans
		.filter((s) => s && s.length > 0 && s.start >= 0)
		.map((s) => ({
			type: 'text_mention' as const,
			offset: s.start + shift,
			length: s.length,
			user: owner,
		}))
}

export async function dispatchPrepared(d: PreparedDispatch): Promise<void> {
	// WhatsApp quote -> Telegram reply. The destination group gates the
	// native reply so a pre-move row stranded in the other group degrades
	// to a header instead of misattaching.
	const { replyToTgId, quoteHeader } = resolveQuoteTarget(
		d.db,
		d.jid,
		d.m,
		d.displayName,
		d.aliases,
		d.chatId,
	)
	const label = d.fromMe ? 'You: ' : (d.isGroup ? `${d.senderName}: ` : '')
	// WhatsApp inline markers -> Telegram entities. The sender label (and
	// quote header) are plain text, so entity offsets shift past them.
	// Stickers take no caption, so their fallback header still travels
	// separately via `quote.header` (sent as its own message).
	const stickerFallback = d.media?.kind === 'sticker' && !!quoteHeader && !replyToTgId
	const parsed = waMarkdownToTgEntities(d.text)
	const prefix = `${!stickerFallback && quoteHeader ? quoteHeader + '\n' : ''}${label}`
	const body = `${prefix}${parsed.text}`
	const entities = [
		...parsed.entities.map((e) => ({ ...e, offset: e.offset + prefix.length })),
		...ownerMentionEntities(d.ownerSpans, prefix.length),
	].sort((a, b) => a.offset - b.offset)
	// Unmapped originals can't use reply_parameters - render the fallback
	// header as a real Telegram quote block instead.
	if (!stickerFallback && quoteHeader) {
		entities.unshift({ type: 'blockquote', offset: 0, length: quoteHeader.length })
	}
	if (isAlbumEligible(d.media, d.special, body)) {
		// Photos/videos wait out the album window so rapid bursts cross as
		// one Telegram media group instead of N singles.
		bufferAlbumItem(d.jid, d.m, {
			m: d.m,
			topicId: d.topicId,
			chatId: d.chatId,
			body,
			entities,
			media: d.media,
			replyToTgId,
		})
		return
	}
	// Anything else flushes pending albums first so chat order is preserved,
	// then sends immediately. sendToTopic enqueues each Telegram API call on
	// the limiter itself, so this awaits delivery (with flood retries).
	await flushPendingAlbums(d.jid)
	await sendToTopic(d.topicId, d.chatId, body, entities, d.media, d.special, d.jid, d.m, {
		tgId: replyToTgId,
		header: stickerFallback ? quoteHeader : null,
	})
	// First relay from an undecided chat asks personal-or-business via
	// buttons (no-op for classified chats and single-group mode).
	await maybePromptClassification(d.jid, d.chatId, d.topicId, d.displayName)
}
