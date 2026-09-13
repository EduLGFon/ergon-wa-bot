// Long-text chunking for Telegram sends - one concern, one place.
//
// Telegram hard-rejects sendMessage bodies over 4096 chars (400: message is
// too long) while WhatsApp has no such cap, so a long text used to be dropped
// whole. These helpers split a body into <=4096 segments, preferring newline
// breaks so paragraphs survive, and rebase Telegram entity offsets per
// segment - the message still lands, as a few messages instead of one.
import { tgCall } from './state.ts'
import type { TgEntity } from '../format.ts'

export const TG_TEXT_LIMIT = 4096

export interface TgChunk {
	body: string
	entities: TgEntity[]
}

// Split a body into TG_TEXT_LIMIT-max segments. Entity offsets are relative
// to the ORIGINAL body - each segment keeps only entities fully inside it,
// rebased to segment space; boundary-crossing styling is dropped (overflow
// segments degrade to plain text rather than invalid ranges).
export function chunkTgBody(body: string, entities: TgEntity[]): TgChunk[] {
	if (body.length <= TG_TEXT_LIMIT) return [{ body, entities }]
	const segments: string[] = []
	let rest = body
	while (rest.length > TG_TEXT_LIMIT) {
		let cut = rest.lastIndexOf('\n', TG_TEXT_LIMIT)
		if (cut <= 0) cut = rest.lastIndexOf(' ', TG_TEXT_LIMIT)
		if (cut <= 0) cut = TG_TEXT_LIMIT
		segments.push(rest.slice(0, cut))
		rest = rest.slice(cut)
	}
	if (rest) segments.push(rest)
	const out: TgChunk[] = []
	let start = 0
	for (const seg of segments) {
		const end = start + seg.length
		out.push({
			body: seg,
			entities: entities
				.filter((e) => e.offset >= start && e.offset + e.length <= end)
				.map((e) => ({ ...e, offset: e.offset - start })),
		})
		start = end
	}
	return out
}

// Send a text message to a topic, chunking any over-limit body into
// <=4096 messages via the flood queue so Telegram never rejects the whole
// thing. Every sent segment reports its message id through onSent so the
// caller can persist a mirror row per chunk.
export async function sendTgText(
	api: any,
	chatId: string,
	topicId: number,
	body: string,
	entities: TgEntity[],
	reply: Record<string, unknown> | undefined,
	onSent: (msgId: number) => void,
): Promise<void> {
	for (const chunk of chunkTgBody(body, entities)) {
		const sent = await tgCall(
			() =>
				api.sendMessage(chatId, chunk.body, {
					message_thread_id: topicId,
					...(chunk.entities.length > 0 ? { entities: chunk.entities } : {}),
					...reply,
				}),
			'message',
		) as { message_id: number }
		onSent(sent.message_id)
	}
}
