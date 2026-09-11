// Incoming WA message relay - main upsert loop in one place.
//
// Skips protocol and reaction carriers plus TG echoes, ensures a forum topic
// mapping, degrades unmappable specials to text and routes photos through
// album batching - quote resolution, empty notices and mapping live in
// chat/quote/unsupported helpers so this loop stays small.
import { annotateMentions, getMentionedJids, getMsgText, hasMentionAll, phoneOf } from './text.ts'
import { ensureTopicMapping } from './topics.ts'
import { resolveChatName } from './chat.ts'
import { notifyTopic, relayCtx, shortErr } from './state.ts'
import { canonicalChatJid, ownerWaJids } from './jid.ts'
import { notifyEmptyRelay } from './unsupported.ts'
import { handleWaReactionCarrier, reactionSummaryMode } from './reaction-summary.ts'
import { getSpecialContent } from './special.ts'
import { handleWaPollResults, handleWaPollVote, msgSecretOf } from './polls.ts'
import { handleWaSecretEdit } from './secret-edits.ts'
import { getRichNotice } from './rich.ts'
import { handleWaPin } from './pins.ts'
import { downloadWaMedia } from './media.ts'
import { findKey } from '@util/functions.ts'
import { dispatchPrepared } from './dispatch.ts'
import type { proto } from 'baileys'

export async function handleWAMessages(messages: proto.IWebMessageInfo[]) {
	const { db, limiter, tg } = relayCtx
	if (!db || !limiter || !tg) return

	for (const m of messages) {
		let topicId: number | null = null
		let chatId: string | null = null
		try {
			if (!m?.message || !m.key) continue
			// Skip protocol traffic (deletes, history sync, ...) and reaction
			// carriers: Baileys delivers every reaction BOTH as messages.upsert
			// with reactionMessage content AND as messages.reaction. The
			// carrier's reactionMessage.text is the emoji itself, which
			// getMsgText would otherwise relay as a bogus "You: ❤️" message -
			// reactions travel via handleWaReactions only.
			if (findKey(m.message, 'protocolMessage')) continue
			const reactionNode = findKey(m.message, 'reactionMessage')
			if (reactionNode) {
				// Summary mode attributes authors from the carrier itself (the
				// messages.reaction event carries no author); otherwise
				// reactions travel via handleWaReactions only (see relay.ts).
				if (reactionSummaryMode) await handleWaReactionCarrier(m, reactionNode)
				continue
			}
			// Pin carriers (pinInChatMessage) ride the same upsert event - they
			// resolve the mirror and pin it natively instead of falling through
			// to the unsupported notice below.
			if (findKey(m.message, 'pinInChatMessage')) {
				await handleWaPin(m)
				continue
			}
			// Poll votes and result snapshots ride the same upsert event - votes
			// decrypt against the stored poll secret, snapshots render as
			// results. Both resolve their own mirror, no topic is created here.
			if (findKey(m.message, 'pollUpdateMessage')) {
				await handleWaPollVote(m)
				continue
			}
			if (
				findKey(m.message, 'pollResultSnapshotMessage') ||
				findKey(m.message, 'pollResultSnapshotMessageV3')
			) {
				await handleWaPollResults(m)
				continue
			}
			// Secret-encrypted envelopes (newer clients seal every edit this
			// way) decrypt against the stored original secret, or degrade to a
			// calm line. Resolves its own mirror, no topic is created here.
			if (findKey(m.message, 'secretEncryptedMessage')) {
				await handleWaSecretEdit(m)
				continue
			}

			const rawJid = m.key.remoteJid
			if (!rawJid || rawJid === 'status@broadcast') continue
			// Canonicalize LID/PN variants to one chat before any mapping
			// lookup, so one person never splits across two topics.
			const { canonical: jid, aliases } = await canonicalChatJid(m.key)
			if (!jid) continue
			// Own messages: TG-TO-WA sends re-emit here with fromMe=true. Those
			// are already in reply_map, so skip them - but messages sent from
			// the phone/client are new (unmapped) and mirror with a `You:`
			// label. The map check doubles as redelivery dedupe. Caption
			// follow-ups have no TG row, so their echoes are marked by id.
			if (m.key.fromMe && !!m.key.id && db.takeFollowUp(m.key.id)) continue
			const echoRow = m.key.fromMe && !!m.key.id
				? db.getByWaMsgIdAny(m.key.id, [jid, ...aliases])
				: undefined
			if (echoRow) {
				// Own-send echo: the mirror already exists, but the echo may
				// carry the messageSecret our send lacked - backfill it so later
				// encrypted edits of this message can decrypt.
				if (!echoRow.wa_msg_secret) {
					db.saveMsgSecret(echoRow.tg_chat_id, echoRow.tg_msg_id, msgSecretOf(m))
				}
				continue
			}
			const isGroup = jid.endsWith('@g.us')
			const chatType: '1:1' | 'group' = isGroup ? 'group' : '1:1'
			const fromMe = !!m.key.fromMe

			const displayName = await resolveChatName(jid, m.pushName, isGroup, fromMe)
			const senderName = m.key.fromMe
				? 'You'
				: (isGroup ? (m.pushName || phoneOf(m.key.participant) || 'unknown') : displayName)

			const ensured = await ensureTopicMapping(jid, displayName, chatType, isGroup, {
				canRename: !fromMe,
				aliases,
			})
			if (!ensured) continue
			topicId = ensured.topicId
			chatId = ensured.chatId
			// Local string-typed alias like tid below: the outer chatId stays
			// nullable for the catch-block notify, everything below needs one.
			const cid: string = chatId
			// Local number-typed alias: the outer topicId stays nullable for
			// the catch-block notify, but everything below needs a number.
			const tid: number = topicId

			// Owner mentions become real Telegram pings downstream: match
			// individual mentions against the owner's WA JIDs, @all always
			// includes them.
			const annotated = annotateMentions(getMsgText(m.message), getMentionedJids(m), {
				jids: await ownerWaJids(),
				all: hasMentionAll(m.message),
			})
			let text = annotated.text
			const dl = await downloadWaMedia(m)
			const media = dl?.media ?? null
			let special = getSpecialContent(m.message)
			// Content Telegram can't represent natively degrades to text
			// BEFORE entity parsing, so formatting offsets stay consistent.
			if (special?.kind === 'poll' && special.options.filter((o) => o.trim()).length < 2) {
				const opts = special.options.join('\n')
				text = `📊 ${special.question}${opts ? '\n' + opts : ''}${text ? '\n' + text : ''}`
				special = null
			}
			if (special?.kind === 'contact' && !special.phone) {
				text = `👤 ${special.name || 'Contact'}${text ? '\n' + text : ''}`
				special = null
			}

			// Rich types with no native Telegram mapping degrade to a readable
			// text notice instead of the unsupported line below.
			if (!text && !media && !special) {
				const rich = getRichNotice(m.message, jid)
				if (rich) text = rich
			}
			if (!text && !media && !special) {
				if (topicId !== null) await notifyEmptyRelay(cid, topicId, dl, m, senderName)
				continue
			}

			await dispatchPrepared({
				db,
				jid,
				aliases,
				m,
				chatId: cid,
				topicId: tid,
				displayName,
				senderName,
				fromMe,
				isGroup,
				text,
				ownerSpans: annotated.ownerSpans,
				media,
				special,
			})
		} catch (e) {
			console.error('[BRIDGE] failed to relay one WA message:', e)
			if (topicId !== null && chatId) {
				await notifyTopic(
					chatId,
					topicId,
					`⚠️ Couldn't relay a WhatsApp message: ${shortErr(e)}`,
				)
			}
		}
	}
}
