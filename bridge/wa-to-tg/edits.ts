// WhatsApp edit relay - text and caption updates in one place.
//
// Edits arrive as `messages.update` with editedMessage payloads while revokes
// arrive on the same event with null message - this routes each mirror to the
// right Telegram endpoint and skips TG-initiated echoes to avoid 400 loops.
import { annotateMentions, getMsgText, hasMentionAll, mentionedJidsOf, phoneOf } from './text.ts'
import { describeErr, logEditFailure, routeEdit } from './errors.ts'
import { chatForReply } from './routing.ts'
import { type proto, WAMessageStubType } from 'baileys'
import { waMarkdownToTgEntities } from '../format.ts'
import { candidatesOf, ownerWaJids } from './jid.ts'
import { relayCtx, tgCall } from './state.ts'
import { ownerMentionEntities } from './dispatch.ts'
import { deleteTgMirror } from './deletes.ts'

// WhatsApp message edit -> Telegram edit. Edits arrive as `messages.update`
// with `update.message.editedMessage.message` (never as upsert). "Delete for
// everyone" revokes arrive on the SAME event with `update.message === null`
// and `messageStubType === REVOKE` - Baileys only emits `messages.delete`
// for local "delete for me" syncs, so revokes are handled here too. The
// mirror message is always bot-owned, so Telegram's 48h edit window is the
// only platform limit - but mirrors of stickers/polls/venues/contacts can't
// be edited at all, and rows predating tg_kind fall back to try-both.
export async function handleWaEdits(
	updates: { key: proto.IMessageKey; update: { message?: any; messageStubType?: number } }[],
): Promise<void> {
	const { db, limiter, tg, groups } = relayCtx
	if (!db || !limiter || !tg) return

	for (const { key, update } of updates) {
		try {
			// Revoke ("delete for everyone") - same event, null message.
			if (update?.message == null && update?.messageStubType === WAMessageStubType.REVOKE) {
				const id = key?.id
				if (!id || !key?.remoteJid || key.remoteJid === 'status@broadcast') continue
				const cands = candidatesOf(key)
				const mapping = cands.map((c) => db.getByJidOrAlias(c)).find((m) =>
					m && !m.archived && !m.muted
				)
				if (!mapping) continue
				// A TG-initiated edit mark is irrelevant here, but consuming
				// it keeps the guard set from growing stale.
				db.takeTgEdit(mapping.whatsapp_jid, id)
				await deleteTgMirror(mapping.whatsapp_jid, id, cands)
				continue
			}
			const edited = update?.message?.editedMessage?.message
			// Anything else (receipts, status, poll votes, ...) is not an edit -
			// skip silently, these fire constantly.
			if (!edited || typeof edited !== 'object') continue
			const id = key?.id
			if (!id || !key?.remoteJid || key.remoteJid === 'status@broadcast') {
				continue
			}
			const cands = candidatesOf(key)
			const jid = cands[0]
			// Echo of our own TG-TO-WA edit (marked before the WA send) - the
			// TG message already shows this text; editing would 400.
			// Marked with the canonical mapping JID on the TG side, so try
			// every variant before relaying.
			const mapping = cands.map((c) => db.getByJidOrAlias(c)).find((m) =>
				m && !m.archived && !m.muted
			)
			if (!mapping) {
				continue
			}
			if (db.takeTgEdit(mapping.whatsapp_jid, id)) {
				continue
			}
			const target = db.getByWaMsgIdAny(id, [mapping.whatsapp_jid, ...cands])
			if (!target) {
				continue
			}

			const route = routeEdit((target as { tg_kind?: string }).tg_kind)
			if (route === 'skip') {
				continue
			}

			const isGroup = jid.endsWith('@g.us')
			const label = key.fromMe
				? 'You: '
				: (isGroup ? `${phoneOf(key.participant) || 'unknown'}: ` : '')
			const annotated = annotateMentions(
				getMsgText(edited as proto.IMessage),
				mentionedJidsOf(edited),
				{ jids: await ownerWaJids(), all: hasMentionAll(edited as proto.IMessage) },
			)
			const parsed = waMarkdownToTgEntities(annotated.text)
			const body = `${label}${parsed.text}`
			const entities = [
				...parsed.entities.map((e) => ({ ...e, offset: e.offset + label.length })),
				...ownerMentionEntities(annotated.ownerSpans, label.length),
			].sort((a, b) => a.offset - b.offset)
			const rich = entities.length > 0 ? { entities } : undefined

			// Each attempt is its own limiter slot (never nested - a tgCall
			// awaiting another tgCall would deadlock the FIFO queue).
			const chatId = chatForReply(target, mapping, groups)
			try {
				if (route === 'text' || route === 'both') {
					await tgCall(
						() => tg!.api.editMessageText(chatId, target.tg_msg_id, body, rich),
						'edit-text',
					)
				} else {
					await tgCall(() =>
						tg!.api.editMessageCaption(chatId, target.tg_msg_id, {
							caption: body.slice(0, 1024) || undefined,
						}), 'edit-caption')
				}
			} catch (first) {
				// Legacy 'unknown' rows: the mirror type is a guess, so a
				// failed text edit retries as caption before giving up.
				if (route === 'both') {
					try {
						await tgCall(
							() =>
								tg!.api.editMessageCaption(chatId, target.tg_msg_id, {
									caption: body.slice(0, 1024) || undefined,
								}),
							'edit-caption',
						)
					} catch (second) {
						logEditFailure(target.tg_msg_id, second, String(describeErr(first)))
					}
				} else {
					logEditFailure(target.tg_msg_id, first)
				}
			}
		} catch (e) {
			console.error('[BRIDGE] failed to relay one WA edit:', e)
		}
	}
}
