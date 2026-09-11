// WhatsApp encrypted edits - MESSAGE_EDIT envelopes in one place.
//
// Newer WhatsApp clients seal every message edit inside a
// secretEncryptedMessage envelope (secretEncType MESSAGE_EDIT), encrypted
// with the ORIGINAL message's messageSecret - Baileys has no handling, so
// these arrived as "secret encrypted ... didn't cross" notices. This
// decrypts against the secret stored at mirror time (same HKDF construction
// as poll votes, "Message Edit" label, empty AAD) and replays the result
// through the normal edit path; anything undecryptable degrades to a calm
// reply under the mirror instead of the scary unsupported line.
import { aesDecryptGCM, hmacSign, proto } from 'baileys'
import { candidatesOf, normalizeJid, selfJid, stripDevice } from './jid.ts'
import { notifyTopic, relayCtx, tgCall } from './state.ts'
import { chatForMapping } from './routing.ts'
import { handleWaEdits } from './edits.ts'
import { findKey } from '@util/functions.ts'
import { phoneOf } from './text.ts'
import bot from '@plugin/bot.ts'

export interface SecretEditContext {
	msgId: string
	// Editor JID candidates - WA may seal with the LID or PN identity,
	// GCM auth cleanly rejects the wrong ones. Editor always equals the
	// original author (only own messages are editable).
	senderJids: string[]
	secret: Uint8Array
}

// Decrypt a MESSAGE_EDIT envelope - tries each sender candidate in both
// info slots. Returns the inner Message, or null when nothing verifies.
export function decryptSecretEdit(
	encPayload: Uint8Array,
	encIv: Uint8Array,
	ctx: SecretEditContext,
): proto.Message | null {
	try {
		if (!encPayload?.length || encIv?.length !== 12) return null
		if (!ctx.msgId || !ctx.secret?.length) return null
		const senders = [...new Set(ctx.senderJids.filter(Boolean))]
		if (senders.length === 0) return null
		for (const orig of senders) {
			for (const editor of senders) {
				try {
					const sign = Buffer.concat([
						Buffer.from(ctx.msgId),
						Buffer.from(orig),
						Buffer.from(editor),
						Buffer.from('Message Edit'),
						new Uint8Array([1]),
					])
					const key0 = hmacSign(ctx.secret, new Uint8Array(32), 'sha256')
					const decKey = hmacSign(sign, key0, 'sha256')
					const plain = aesDecryptGCM(encPayload, decKey, encIv, new Uint8Array(0))
					return proto.Message.decode(plain)
				} catch {
					// Wrong identity mix - try the next one.
				}
			}
		}
		return null
	} catch {
		return null
	}
}

// Editor identity candidates - the envelope author plus its LID/PN twins
// when the signal store already knows them.
async function senderCandidates(raw: string): Promise<string[]> {
	const out = new Set<string>()
	const base = stripDevice(raw)
	if (base) out.add(base)
	try {
		const map = (bot.sock as any)?.signalRepository?.lidMapping
		const pn = await map?.getPNForLID?.(base)
		const lid = await map?.getLIDForPN?.(base)
		for (const j of [pn, lid]) {
			const n = normalizeJid(typeof j === 'string' ? j : '')
			if (n) out.add(stripDevice(n))
		}
	} catch {
		// Twins unknown - the bare identity still usually verifies.
	}
	return [...out]
}

// WhatsApp encrypted edit -> decrypted replay through the normal edit path.
// Non-edit envelopes and anything undecryptable degrade to a calm reply
// under the mirror (or a plain topic line when the target never crossed).
export async function handleWaSecretEdit(m: proto.IWebMessageInfo): Promise<void> {
	const { db, limiter, tg, groups } = relayCtx
	if (!db || !limiter || !tg) return
	try {
		const node = findKey(m.message, 'secretEncryptedMessage')
		if (!node || !m.key) return
		if (!m.key.remoteJid || m.key.remoteJid === 'status@broadcast') return
		const cands = candidatesOf(m.key)
		const mapping = cands.map((c) => db.getByJidOrAlias(c)).find((m) =>
			m && !m.archived && !m.muted
		)
		if (!mapping) return
		const type = Number(node.secretEncType ?? 0)
		const targetId = node.targetMessageKey?.id
		const isGroup = (m.key.remoteJid || '').endsWith('@g.us')
		const senderName = m.key.fromMe
			? 'You'
			: (isGroup
				? (m.pushName || phoneOf(m.key.participant) || 'unknown')
				: (m.pushName || 'unknown'))
		const chatId = chatForMapping(mapping, groups)
		const topicId = mapping.telegram_topic_id
		const entry = targetId
			? db.getByWaMsgIdAny(targetId, [mapping.whatsapp_jid, ...cands])
			: undefined
		// Reply under the mirror when it crossed, so the edit has context.
		const say = (line: string): Promise<unknown> =>
			entry
				? tgCall(() =>
					tg!.api.sendMessage(chatId, line, {
						message_thread_id: topicId,
						reply_parameters: {
							message_id: entry.tg_msg_id,
							allow_sending_without_reply: true,
						},
					}), 'notice')
				: notifyTopic(chatId, topicId, line)
		// Event edits and future envelope types have no Telegram shape -
		// name them calmly instead of the generic unsupported line.
		if (type !== 2 || !targetId) {
			const what = type === 1 ? 'event update' : 'encrypted update'
			await say(`✏️ ${senderName} sent an encrypted ${what} - content unavailable.`)
			return
		}
		if (!entry?.wa_msg_secret) {
			await say(`✏️ ${senderName} edited a message (encrypted edit - new text unavailable).`)
			return
		}
		const me = selfJid()
		const editor = m.key.fromMe ? me : stripDevice(m.key.participant || m.key.remoteJid)
		const inner = decryptSecretEdit(node.encPayload, node.encIv, {
			msgId: targetId,
			senderJids: await senderCandidates(editor || me),
			secret: Buffer.from(entry.wa_msg_secret),
		})
		// The decrypted protocolMessage.editedMessage IS the new content
		// (a Message) - the legacy update shape wraps it one level deeper.
		const edited = inner?.protocolMessage?.editedMessage
		if (!edited || typeof edited !== 'object') {
			await say(`✏️ ${senderName} edited a message (encrypted edit - new text unavailable).`)
			return
		}
		// Replay through the normal edit path - labels, entities, caption
		// routing and failure lines all apply unchanged.
		let origKey: any = null
		try {
			origKey = JSON.parse(entry.wa_key_json)
		} catch {
			origKey = null
		}
		await handleWaEdits([{
			key: {
				remoteJid: entry.wa_jid,
				id: targetId,
				fromMe: !!origKey?.fromMe,
				participant: origKey?.participant,
			} as proto.IMessageKey,
			update: { message: { editedMessage: { message: edited } } },
		}])
	} catch (e) {
		console.error('[BRIDGE] failed to relay one WA secret edit:', e)
	}
}
