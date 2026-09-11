// WhatsApp pin relay - mirror pin/unpin actions onto the topic in one place.
//
// Pin actions arrive as messages.upsert carriers (pinInChatMessage, type 1 =
// pin and 2 = unpin) while the pinned message itself stays untouched - this
// finds the Telegram mirror through reply_map and pins it natively, plus a
// small service line naming who acted. TG-initiated echoes are consumed via
// the db guard so genuine phone-side pins still relay.
import { notifyTopic, relayCtx, shortErr, tgCall } from './state.ts'
import { chatForReply } from './routing.ts'
import { findKey } from '@util/functions.ts'
import { candidatesOf } from './jid.ts'
import { phoneOf } from './text.ts'
import type { proto } from 'baileys'

// PinInChat.Type values - the proto enum is type-only here, so the two
// numbers this module acts on live next to their meaning.
const PIN_FOR_ALL = 1
const UNPIN_FOR_ALL = 2

// WhatsApp pin/unpin -> pin/unpin the Telegram mirror. The carrier key is
// the PIN message itself (fresh id); the target lives in pin.key.id. Needs
// the bot to be supergroup admin with pin rights - failures land as a topic
// notice, never a throw.
export async function handleWaPin(m: proto.IWebMessageInfo): Promise<void> {
	const { db, limiter, tg, groups } = relayCtx
	if (!db || !limiter || !tg) return
	try {
		const pin = findKey(m.message, 'pinInChatMessage')
		const targetId = pin?.key?.id
		if (!pin || !targetId || !m.key) return
		if (!m.key.remoteJid || m.key.remoteJid === 'status@broadcast') return
		const cands = candidatesOf(m.key)
		const mapping = cands.map((c) => db.getByJidOrAlias(c)).find((m) =>
			m && !m.archived && !m.muted
		)
		if (!mapping) return
		// Echo of our own TG-TO-WA pin (marked before the WA send) - the
		// topic already shows the pin. NOTE: no blanket fromMe skip, same as
		// reactions - genuine pins made on the owner's phone arrive fromMe
		// too and must still relay.
		if (db.takeTgPin(mapping.whatsapp_jid, targetId)) return
		// Unmapped targets (pre-bridge history, pruned) have no mirror to
		// pin - nothing to do.
		const target = db.getByWaMsgIdAny(targetId, [mapping.whatsapp_jid, ...cands])
		if (!target) return
		const type = Number(pin.type)
		if (type !== PIN_FOR_ALL && type !== UNPIN_FOR_ALL) return
		const isGroup = (m.key.remoteJid || '').endsWith('@g.us')
		const senderName = m.key.fromMe
			? 'You'
			: (isGroup
				? (m.pushName || phoneOf(m.key.participant) || 'unknown')
				: (m.pushName || 'unknown'))
		const chatId = chatForReply(target, mapping, groups)
		const line = type === PIN_FOR_ALL ? 'pinned a message' : 'unpinned a message'
		try {
			if (type === PIN_FOR_ALL) {
				await tgCall(
					() =>
						tg!.api.pinChatMessage(chatId, target.tg_msg_id, {
							disable_notification: true,
						}),
					'pin',
				)
			} else {
				await tgCall(() => tg!.api.unpinChatMessage(chatId, target.tg_msg_id), 'unpin')
			}
		} catch (e) {
			console.error('[BRIDGE] failed to pin one TG mirror:', e)
			await notifyTopic(
				chatId,
				mapping.telegram_topic_id,
				`⚠️ Couldn't sync a WhatsApp pin: ${shortErr(e)}`,
			)
			return
		}
		await notifyTopic(chatId, mapping.telegram_topic_id, `📌 ${senderName} ${line}`)
	} catch (e) {
		console.error('[BRIDGE] failed to relay one WA pin:', e)
	}
}
