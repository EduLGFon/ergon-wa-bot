// WhatsApp delete relay - spoiler tombstones before hard deletes.
//
// Deletes arrive as `messages.delete` (delete-for-me syncs) and revokes as
// `messages.update` REVOKE stubs - this prefers re-editing the mirror into a
// spoiler tombstone so context survives, deleting only when no content was
// stored.
import { STORED_TEXT_MAX } from './media-utils.ts'
import { chatForReply } from './routing.ts'
import { logDeleteFailure } from './errors.ts'
import { candidatesOf } from './jid.ts'
import { relayCtx, tgCall } from './state.ts'
import type { TgEntity } from '../format.ts'
import type { ReplyMapRow } from '../db.ts'
import type { proto } from 'baileys'

// WhatsApp delete/revoke -> delete the Telegram mirror. Deletes arrive as
// `messages.delete` with `{ keys }` (per-message revoke) or `{ jid, all }`
// (clear-chat, which has no meaningful topic equivalent and is skipped).
// Needs the bot to be supergroup admin with delete rights; messages older
// than ~48h or already gone fail silently. The reply_map row is dropped on
// success so later edits/reactions to the deleted message don't 400.
export async function handleWaDeletes(
	payload: { keys?: proto.IMessageKey[]; jid?: string; all?: boolean },
): Promise<void> {
	const { db, limiter, tg } = relayCtx
	if (!db || !limiter || !tg) return
	if (!payload?.keys || payload.keys.length === 0) {
		return
	}
	for (const key of payload.keys) {
		try {
			const id = key?.id
			if (!id || !key?.remoteJid || key.remoteJid === 'status@broadcast') continue
			const cands = candidatesOf(key)
			const mapping = cands.map((c) => db.getByJidOrAlias(c)).find((m) =>
				m && !m.archived && !m.muted
			)
			if (!mapping) continue
			await deleteTgMirror(mapping.whatsapp_jid, id, cands)
		} catch (e) {
			console.error('[BRIDGE] failed to relay one WA delete:', e)
		}
	}
}

// Marker heading a spoiler tombstone. The original content follows it,
// hidden behind a spoiler entity - users see WHY it's blurred.
export const SPOILER_MARKER = '🗑️ Deleted on WhatsApp\n'

// Re-edit a mirrored message into a spoiler tombstone instead of deleting
// it. Returns true on success. Uses the STORED original (so repeat revokes
// are idempotent); text mirrors edit in place, media mirrors edit the
// caption. Anything else (stickers, specials, legacy rows without content)
// returns false so the caller falls back to deleting.
export async function spoilerTgMirror(target: ReplyMapRow, chatId: string): Promise<boolean> {
	const { tg, db, limiter } = relayCtx
	if (!tg || !limiter || !db) return false
	const kind = target.tg_kind
	if (kind !== 'text' && kind !== 'media' && kind !== 'unknown') return false
	const orig = (target.tg_text || '').slice(0, STORED_TEXT_MAX)
	if (!orig) return false
	let kept: TgEntity[] = []
	try {
		const parsed: unknown = JSON.parse(target.tg_entities || '[]')
		if (Array.isArray(parsed)) {
			// Stored snapshots predate the text_mention variant and tombstones drop
			// the ping user anyway - the cast restores the validated shape.
			kept = (parsed as any[]).filter((e) =>
				e && typeof e.offset === 'number' && typeof e.length === 'number' &&
				e.offset >= 0 && e.length > 0 && e.offset + e.length <= orig.length &&
				typeof e.type === 'string'
			).map((e) => ({ type: e.type, offset: e.offset, length: e.length }) as TgEntity)
		}
	} catch {
		kept = []
	}
	for (const e of kept) e.offset += SPOILER_MARKER.length
	kept.push({ type: 'spoiler', offset: SPOILER_MARKER.length, length: orig.length })
	const rich = kept.length > 0 ? { entities: kept } : undefined
	try {
		try {
			if (kind === 'media') {
				const caption = (SPOILER_MARKER + orig).slice(0, 1024)
				const cEnts = kept.filter((e) => e.offset + e.length <= caption.length)
				await tgCall(() =>
					tg!.api.editMessageCaption(chatId, target.tg_msg_id, {
						caption,
						caption_entities: cEnts.length > 0 ? cEnts : undefined,
					}), 'edit-caption')
			} else {
				await tgCall(() =>
					tg!.api.editMessageText(
						chatId,
						target.tg_msg_id,
						SPOILER_MARKER + orig,
						rich,
					), 'edit-text')
			}
			return true
		} catch {
			return false
		}
	} catch {
		return false
	}
}

// Delete the Telegram mirror of a revoked/deleted WA message. Shared by the
// `messages.delete` path (delete-for-me syncs) and the REVOKE branch of
// `messages.update` (delete-for-everyone). Prefers re-editing the mirror
// into a spoiler tombstone (content stays visible on tap); only mirrors
// without stored content (TG-originated rows, stickers, specials) or failed
// spoiler edits are actually deleted. Drops the reply_map row when the
// message ends up deleted so later edits/reactions to it don't 400.
export async function deleteTgMirror(
	jid: string,
	id: string,
	aliases: string[] = [],
): Promise<void> {
	const { db, limiter, tg, groups } = relayCtx
	if (!db || !limiter || !tg) return
	const mapping = db.getByJidOrAlias(jid)
	if (!mapping || mapping.archived || mapping.muted) return
	const target = db.getByWaMsgIdAny(id, [mapping.whatsapp_jid, jid, ...aliases])
	if (!target) {
		return
	}
	const chatId = chatForReply(target, mapping, groups)
	if (await spoilerTgMirror(target, chatId)) return
	try {
		await tgCall(() => tg!.api.deleteMessage(chatId, target.tg_msg_id), 'delete')
		db!.deleteReplyMapAt(chatId, target.tg_msg_id)
	} catch (e) {
		logDeleteFailure(target.tg_msg_id, e)
	}
}
