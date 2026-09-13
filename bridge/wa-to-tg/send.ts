// Telegram topic send - text, media and special routing in one place.
//
// Location/contact/poll have no caption concept so they go first with the
// native reply, stickers without captions get quote headers separately and
// long captions overflow - media-kind endpoints live in send-media.ts so
// this router stays small.
import { sendTgText } from './chunk.ts'
import { extOf, storedEntities, storedText } from './media-utils.ts'
import { msgSecretOf, pollCreatorOf } from './polls.ts'
import { sendSpecial, type WaSpecial } from './special.ts'
import { getRetryAfterSeconds } from '../rate-limiter.ts'
import type { BridgeDB, MirrorKind } from '../db.ts'
import { relayCtx, tgCall } from './state.ts'
import { dispatchKind } from './send-media.ts'
import type { TgEntity } from '../format.ts'
import type { proto } from 'baileys'
import { InputFile } from 'grammy'

export async function sendToTopic(
	topicId: number,
	chatId: string,
	body: string,
	entities: TgEntity[],
	media:
		| { kind: string; buffer: Uint8Array; mime?: string; fileName?: string; ptt?: boolean }
		| null,
	special: WaSpecial | null,
	waJid: string,
	waMsg: proto.IWebMessageInfo,
	quote: { tgId: number | null; header: string | null },
): Promise<void> {
	const { tg, db } = relayCtx
	if (!tg || !db) return
	// Local non-null handle: module-level relay narrowing does not survive
	// inside the tgCall closures below, so capture it once here.
	const api = tg.api
	// Native Telegram quote when the original was bridged. allow_sending_
	// without_reply keeps the send alive if that message was deleted since.
	const reply = quote.tgId
		? { reply_parameters: { message_id: quote.tgId, allow_sending_without_reply: true } }
		: undefined
	const thread = { message_thread_id: topicId } as const
	// Persist the mirror content alongside the mapping so a later revoke can
	// re-edit the message into a spoiler tombstone instead of deleting it.
	// The reply target travels too so a topic move can re-thread history.
	// Every mirror keeps its messageSecret so later secretEncryptedMessage
	// (MESSAGE_EDIT) envelopes sealed against it can decrypt.
	const msgSecret = msgSecretOf(waMsg)
	const save = (tgId: number, kind: MirrorKind): void => {
		;(db as BridgeDB).saveReplyMap(
			tgId,
			waJid,
			waMsg.key?.id || '',
			JSON.stringify(waMsg.key || {}),
			kind,
			storedText(body),
			storedEntities(entities),
			{ chatId, replyTo: quote.tgId },
		)
		;(db as BridgeDB).saveMsgSecret(chatId, tgId, msgSecret)
	}

	// Location / contact / poll have no caption concept: the content goes
	// first (carrying the native reply), then any text as a follow-up.
	// Each API call is its own limiter slot.
	if (special) {
		const sent = await sendSpecial(topicId, chatId, special, reply)
		if (sent) {
			save(sent.msgId, 'special')
			// Poll mirrors keep their crypto metadata so votes relay both
			// ways (decrypt incoming, sign outgoing) and poll_answer updates
			// resolve through the stored Telegram poll id.
			if (special.kind === 'poll') {
				db.savePollMeta(chatId, sent.msgId, {
					secret: msgSecret,
					options: special.options,
					creator: pollCreatorOf(waMsg),
					pollId: sent.pollId,
				})
			}
		}
		if (body) {
			await sendTgText(
				api,
				chatId,
				topicId,
				body,
				entities,
				reply,
				(msgId) => save(msgId, 'text'),
			)
		}
		return
	}

	if (!media) {
		await sendTgText(
			api,
			chatId,
			topicId,
			body,
			entities,
			reply,
			(msgId) => save(msgId, 'text'),
		)
		return
	}

	// Stickers take no caption: deliver an unmapped quote header as its own
	// quote-styled message so the context still lands in the topic.
	if (media.kind === 'sticker' && quote.header && !quote.tgId) {
		const header: string = quote.header
		await tgCall(() =>
			api.sendMessage(chatId, header, {
				message_thread_id: topicId,
				entities: [{ type: 'blockquote', offset: 0, length: header.length }],
			}), 'message')
	}

	const caption = body.length > 1024 ? undefined : (body || undefined)
	const captionEntities = caption && entities.length > 0
		? { caption_entities: entities }
		: undefined
	const file = new InputFile(media.buffer, media.fileName || `file.${extOf(media)}`)

	// Round video notes take no caption and need their own endpoint - a
	// non-round-compatible file falls back to a plain video instead.
	if (media.kind === 'round') {
		let sentNote: { message_id: number }
		try {
			sentNote = await tgCall(
				() => api.sendVideoNote(chatId, file, { ...thread, ...reply }),
				'video-note',
			)
		} catch (e) {
			// A flood-exhausted send must propagate, not fall back - the
			// fallback would just 429 again. Only non-429 failures (e.g.
			// non-round-compatible file) degrade to a plain video.
			if (getRetryAfterSeconds(e) !== null) throw e
			sentNote = await tgCall(() =>
				api.sendVideo(chatId, file, {
					...thread,
					caption,
					...captionEntities,
					...reply,
				}), 'video')
		}
		save(sentNote.message_id, 'media')
		if (body) {
			await sendTgText(
				api,
				chatId,
				topicId,
				body,
				entities,
				reply,
				(msgId) => save(msgId, 'text'),
			)
		}
		return
	}

	await dispatchKind({
		api,
		chatId,
		media,
		file,
		thread,
		reply,
		body,
		entities,
		caption,
		captionEntities,
		save,
	})
}
