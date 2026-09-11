// Album chunk send - one media group plus caption follow-up.
//
// Split from album-flush.ts so the flush worker stays under the file
// budget: builds the input media, sends the group, records every mirror
// row and delivers overflow captions as one follow-up text.
import { extOf, storedEntities, storedText } from './media-utils.ts'
import { relayCtx, tgCall } from './state.ts'
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
	const inputMedia = chunk.map((it, i) => {
		const file = new InputFile(
			it.media.buffer,
			it.media.fileName || `file.${extOf(it.media)}`,
		)
		const captioned: Record<string, unknown> = i === 0 && first.body
			? { caption: first.body.slice(0, 1024) }
			: {}
		if (i === 0 && first.body && first.entities.length > 0) {
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
	const sentArr = await tgCall(
		() =>
			tg!.api.sendMediaGroup(chatId, inputMedia as any, {
				message_thread_id: first.topicId,
				...reply,
			}),
		'media-group',
	) as { message_id: number }[]
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
				{ chatId, replyTo: first.replyToTgId },
			)
			db!.saveMsgSecret(chatId, s.message_id, msgSecretOf(it.m))
		}
	})
	// Captions beyond the first don't fit in a media group - deliver them
	// as one follow-up instead of dropping them.
	const extras = chunk.slice(1).map((it) => it.body).filter((b) => b)
	if (extras.length === 0) return
	const followBody = extras.join('\n')
	const sent = await tgCall(() =>
		tg!.api.sendMessage(chatId, followBody, {
			message_thread_id: first.topicId,
		}), 'message')
	const last = chunk[chunk.length - 1]
	db!.saveReplyMap(
		sent.message_id,
		jid,
		last.m.key?.id || '',
		JSON.stringify(last.m.key || {}),
		'text',
		storedText(followBody),
		null,
		{ chatId },
	)
	db!.saveMsgSecret(chatId, sent.message_id, msgSecretOf(last.m))
}
