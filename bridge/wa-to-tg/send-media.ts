// Telegram media dispatch - kind-specific endpoints in one place.
//
// Animations, voices and stickers each need their own Bot API method with
// flood-aware fallback - this keeps the kind switch out of the main send
// flow so send.ts stays under the file-size budget.
import { sendTgText } from './chunk.ts'
import { getRetryAfterSeconds } from '../rate-limiter.ts'
import { tgCall } from './state.ts'
import type { TgEntity } from '../format.ts'
import type { InputFile } from 'grammy'

export interface MediaDispatch {
	api: any
	chatId: string
	media: { kind: string; buffer: Uint8Array; mime?: string; fileName?: string; ptt?: boolean }
	file: InputFile
	thread: { message_thread_id: number }
	reply:
		| { reply_parameters: { message_id: number; allow_sending_without_reply: boolean } }
		| undefined
	body: string
	entities: TgEntity[]
	caption: string | undefined
	captionEntities: { caption_entities: any[] } | undefined
	save: (tgId: number, kind: any) => void
}

export async function dispatchKind(d: MediaDispatch): Promise<void> {
	const {
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
	} = d
	let sent: { message_id: number }

	switch (media.kind) {
		case 'image':
			sent = await tgCall(() =>
				api.sendPhoto(chatId, file, {
					...thread,
					caption,
					...captionEntities,
					...reply,
				}), 'photo')
			break
		case 'video':
		case 'gif':
			// WA GIFs are mp4 videos with gifPlayback - Telegram renders them
			// as GIFs (looping, muted) via sendAnimation instead of sendVideo.
			sent = media.kind === 'gif'
				? await tgCall(() =>
					api.sendAnimation(chatId, file, {
						...thread,
						caption,
						...captionEntities,
						...reply,
					}), 'animation')
				: await tgCall(() =>
					api.sendVideo(chatId, file, {
						...thread,
						caption,
						...captionEntities,
						...reply,
					}), 'video')
			break
		case 'voice':
			sent = await tgCall(() =>
				api.sendVoice(chatId, file, {
					...thread,
					caption,
					...captionEntities,
					...reply,
				}), 'voice')
			break
		case 'audio':
			sent = await tgCall(() =>
				api.sendAudio(chatId, file, {
					...thread,
					caption,
					...captionEntities,
					...reply,
				}), 'audio')
			break
		case 'sticker':
			try {
				sent = await tgCall(() =>
					api.sendSticker(chatId, file, {
						message_thread_id: thread.message_thread_id,
						...reply,
					}), 'sticker')
			} catch (e) {
				// A flood-exhausted send must propagate, not fall back - the
				// fallback would just 429 again.
				if (getRetryAfterSeconds(e) !== null) throw e
				sent = await tgCall(() =>
					api.sendDocument(chatId, file, {
						...thread,
						caption,
						...captionEntities,
						...reply,
					}), 'document')
			}
			break
		default:
			sent = await tgCall(() =>
				api.sendDocument(chatId, file, {
					...thread,
					caption,
					...captionEntities,
					...reply,
				}), 'document')
			break
	}
	save(sent.message_id, media.kind === 'sticker' ? 'sticker' : 'media')

	// Captions are capped at 1024 chars - send the overflow as a follow-up,
	// chunked so a long caption can never be rejected whole.
	if (caption === undefined && body) {
		await sendTgText(
			api,
			chatId,
			thread.message_thread_id,
			body,
			entities,
			reply,
			(msgId) => save(msgId, 'text'),
		)
	}
}
