// WhatsApp special content - locations, contacts and polls in one place.
//
// Telegram has native endpoints for these but no caption concept - this
// extracts the WA payload and sends it first so text can follow as a reply,
// degrading short polls and phoneless contacts to text before entity parsing.
import { relayCtx, tgCall } from './state.ts'
import { parseVcard } from '../format.ts'
import type { proto } from 'baileys'
import { unwrap } from './text.ts'

export interface WaSpecialLocation {
	kind: 'location'
	latitude: number
	longitude: number
}
export interface WaSpecialContact {
	kind: 'contact'
	name: string
	phone: string
}
export interface WaSpecialPoll {
	kind: 'poll'
	question: string
	options: string[]
}
export type WaSpecial = WaSpecialLocation | WaSpecialContact | WaSpecialPoll

export function getSpecialContent(message: proto.IMessage | undefined | null): WaSpecial | null {
	try {
		const raw = unwrap(message)
		if (!raw || typeof raw !== 'object') return null
		if (raw.locationMessage) {
			const { degreesLatitude, degreesLongitude } = raw.locationMessage
			if (typeof degreesLatitude === 'number' && typeof degreesLongitude === 'number') {
				return { kind: 'location', latitude: degreesLatitude, longitude: degreesLongitude }
			}
		}
		if (raw.liveLocationMessage) {
			const { latitude, longitude } = raw.liveLocationMessage
			if (typeof latitude === 'number' && typeof longitude === 'number') {
				return { kind: 'location', latitude, longitude }
			}
		}
		if (raw.contactMessage) {
			const { name, phone } = parseVcard(raw.contactMessage.vcard)
			return {
				kind: 'contact',
				name: raw.contactMessage.displayName || name || phone || 'Contact',
				phone,
			}
		}
		// V1/V3/V5 share the PollCreationMessage shape (name + options) -
		// only the version tag differs.
		const pollNode = raw.pollCreationMessage || raw.pollCreationMessageV3 ||
			raw.pollCreationMessageV5
		if (pollNode) {
			const options = (pollNode.options || [])
				.map((o: any) => String(o?.optionName || '').trim())
				.filter((o: string) => o.length > 0)
			return {
				kind: 'poll',
				question: String(pollNode.name || 'Poll'),
				options,
			}
		}
		return null
	} catch {
		return null
	}
}

// Sent special content reference - the message id plus, for polls, the
// Telegram poll id that later links poll_answer updates back to the WA poll.
export interface SentSpecial {
	msgId: number
	pollId: string | null
}

// Sends a location/contact/poll content message. Returns the sent Telegram
// message id (null when the content degrades to a text fallback instead).
export async function sendSpecial(
	topicId: number,
	chatId: string,
	special: WaSpecial,
	reply:
		| { reply_parameters: { message_id: number; allow_sending_without_reply: boolean } }
		| undefined,
): Promise<SentSpecial | null> {
	const { tg } = relayCtx
	if (!tg) return null
	const api = tg.api
	const thread = { message_thread_id: topicId } as const
	switch (special.kind) {
		case 'location': {
			const sent = await tgCall(() =>
				api.sendLocation(
					chatId,
					special.latitude,
					special.longitude,
					{ ...thread, ...reply },
				), 'location')
			return { msgId: sent.message_id, pollId: null }
		}
		case 'contact': {
			const sent = await tgCall(
				() =>
					api.sendContact(chatId, special.phone, special.name, {
						...thread,
						...reply,
					}),
				'contact',
			)
			return { msgId: sent.message_id, pollId: null }
		}
		case 'poll': {
			const question = special.question.slice(0, 300) || 'Poll'
			const options = special.options
				.map((o) => o.slice(0, 100))
				.filter((o) => o.length > 0)
				.slice(0, 10)
			// Telegram needs 2-10 options; shorter lists were already
			// degraded to text by the caller, so this is just a guard.
			if (options.length < 2) return null
			const sent = await tgCall(() =>
				api.sendPoll(
					chatId,
					question,
					options.map((text) => ({ text })),
					{
						...thread,
						is_anonymous: false,
						...reply,
					},
				), 'poll')
			return { msgId: sent.message_id, pollId: sent.poll?.id ?? null }
		}
	}
}
