// Album chunk send - one media group plus caption follow-up.
//
// Split from album-flush.ts so the flush worker stays under the file
// budget: builds the input media, sends the group, records every mirror
// row and delivers overflow captions as one follow-up text.
import { sendTgText } from './chunk.ts'
import { extOf, storedEntities, storedText } from './media-utils.ts'
import { relayCtx, tgCall } from './state.ts'
import { healThreadMapping, isThreadGone } from './send.ts'
import { msgSecretOf } from './polls.ts'
import type { AlbumItem } from './album.ts'
import { InputFile } from 'grammy'

export async function sendAlbumChunk(
	jid: string,
	chatId: string,
	chunk: AlbumItem[],
): Promise<void> {
	const { db, tg } = relayCtx
	if (!db || !tg || chunk.length === 0) return
	const first = chunk[0]
	const buildInputMedia = () =>
		chunk.map((it, i) => {
			const file = new InputFile(
				it.media.buffer,
				it.media.fileName || `file.${extOf(it.media)}`,
			)
			// A captionless album item still carries a sender-labelled body
			// ("Alice: "); using that as a caption or follow-up is what produced
			// the repeated "user:\nuser:" digest after albums.
			const captioned: Record<string, unknown> = i === 0 && first.text.trim() && first.body
				? { caption: first.body.slice(0, 1024) }
				: {}
			if (i === 0 && first.text.trim() && first.body && first.entities.length > 0) {
				captioned.caption_entities = first.entities
			}
			// GIFs ride as plain videos inside media groups (the Bot API has
			// no animation group item).
			return it.media.kind === 'image'
				? { type: 'photo', media: file, ...captioned }
				: { type: 'video', media: file, ...captioned }
		})
	const reply = first.replyToTgId
		? {
			reply_parameters: {
				message_id: first.replyToTgId,
				allow_sending_without_reply: true,
			},
		}
		: undefined
	const priority = !jid.endsWith('@g.us')
	let targetChatId = chatId
	const sendGroup = () =>
		tgCall(
			() =>
				tg!.api.sendMediaGroup(targetChatId, buildInputMedia() as any, {
					message_thread_id: first.topicId,
					...reply,
				}),
			'media-group',
			targetChatId,
			priority,
		) as Promise<{ message_id: number }[]>
	let sentArr: { message_id: number }[]
	try {
		sentArr = await sendGroup()
	} catch (e) {
		// The topic may have been deleted while the album was buffering.
		// Heal once and resend the group into the fresh topic.
		if (!isThreadGone(e)) throw e
		const healed = await healThreadMapping(jid, targetChatId, first.topicId).catch(() => null)
		if (!healed) throw e
		first.topicId = healed.topicId
		targetChatId = healed.chatId
		sentArr = await sendGroup()
	}
	sentArr.forEach((s, i) => {
		const it = chunk[i]
		if (s && it) {
			db!.saveReplyMap(
				s.message_id,
				jid,
				it.m.key?.id || '',
				JSON.stringify(it.m.key || {}),
				'media',
				storedText(it.body),
				storedEntities(it.entities),
				{ chatId: targetChatId, replyTo: first.replyToTgId },
			)
			db!.saveMsgSecret(targetChatId, s.message_id, msgSecretOf(it.m))
		}
	})
	// Captions beyond the first don't fit in a media group - deliver them
	// as one follow-up instead of dropping them, chunked so a very long
	// combined caption can't be rejected whole.
	// Only authored captions become follow-ups; label-only bodies are not
	// content and must never be joined into a digest.
	const extras = chunk.slice(1).filter((it) => it.text.trim()).map((it) => it.body)
	if (extras.length === 0) return
	const followBody = extras.join('\n')
	const last = chunk[chunk.length - 1]
	try {
		await sendTgText(
			tg.api,
			targetChatId,
			first.topicId,
			followBody,
			[],
			undefined,
			(msgId) => {
				db.saveReplyMap(
					msgId,
					jid,
					last.m.key?.id || '',
					JSON.stringify(last.m.key || {}),
					'text',
					storedText(followBody),
					null,
					{ chatId: targetChatId },
				)
				db.saveMsgSecret(targetChatId, msgId, msgSecretOf(last.m))
			},
			priority,
		)
	} catch (e) {
		// The media group already landed. A failed caption follow-up must
		// not make the caller park and replay the whole album (duplicating
		// every photo); log it and keep the mirrors intact.
		console.error('[BRIDGE] album caption follow-up failed:', e)
	}
}
