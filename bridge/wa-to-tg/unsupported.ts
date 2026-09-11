// Unsupported WA message line - names the type and previews content.
//
// When a message has no text, media or special mapping the topic still needs
// a precise report - this names the friendly type, keeps the raw proto key
// and appends sender, id and a content preview when one can be extracted.
import { previewUnsupportedContent } from './unsupported-preview.ts'
import { waDownloadFailureLine } from './media-utils.ts'
import { notifyTopic } from './state.ts'
import type { proto } from 'baileys'
import { unwrap } from './text.ts'

// Friendly names for WhatsApp content types that reach the "no Telegram
// equivalent" branch (i.e. no text, no downloadable media, no
// location/contact/poll). Raw proto keys stay in the notice in parentheses
// so new/renamed types can be reported precisely.
export const WA_UNSUPPORTED_FRIENDLY: Record<string, string> = {
	albumMessage: 'album',
	pollUpdateMessage: 'poll vote',
	pollCreationMessageV3: 'poll',
	pollResultSnapshotMessage: 'poll results',
	contactsArrayMessage: 'contact list',
	groupInviteMessage: 'group invite',
	buttonsMessage: 'interactive message',
	buttonsResponseMessage: 'button reply',
	templateMessage: 'template message',
	templateButtonReplyMessage: 'template reply',
	listMessage: 'list message',
	listResponseMessage: 'list reply',
	interactiveMessage: 'interactive message',
	interactiveResponseMessage: 'interactive reply',
	nativeFlowResponseMessage: 'interactive reply',
	eventMessage: 'event',
	eventResponseMessage: 'event response',
	keepInChatMessage: 'kept message',
	callLogMessage: 'call log',
	scheduledCallCreationMessage: 'scheduled call',
	scheduledCallEditMessage: 'scheduled call update',
	productMessage: 'product',
	orderMessage: 'order',
	invoiceMessage: 'invoice',
	paymentInviteMessage: 'payment invite',
	requestPaymentMessage: 'payment request',
	stickerPackMessage: 'sticker pack',
	newsletterAdminInviteMessage: 'channel invite',
	highlyStructuredMessage: 'template message',
	requestPhoneNumberMessage: 'phone-number request',
	messageHistoryBundle: 'history bundle',
	placeholderMessage: 'placeholder',
	senderKeyDistributionMessage: 'encryption setup',
}

// Envelope/metadata keys that are never the "real" content type. Baileys
// messages almost always carry messageContextInfo alongside the payload, so
// the descriptor must skip it instead of reporting it.
export const WA_ENVELOPE_KEYS = new Set(['messageContextInfo', 'senderKeyDistributionMessage'])

// A media node whose download failed would otherwise vanish silently -
// tell the topic what exactly didn't cross, with its kind and size when the
// node advertised them. Anything else names the raw WhatsApp type plus a
// content preview so the topic shows WHAT didn't cross, not just that
// something didn't.
export async function notifyEmptyRelay(
	chatId: string,
	topicId: number,
	dl: { label: string; bytes: number | null } | null | undefined,
	m: proto.IWebMessageInfo,
	senderName: string,
): Promise<void> {
	if (dl) {
		await notifyTopic(chatId, topicId, waDownloadFailureLine(dl.label, dl.bytes))
	} else {
		const line = waUnsupportedLine(m, senderName)
		console.warn(`[BRIDGE] unsupported WA message: ${line}`)
		await notifyTopic(chatId, topicId, line)
	}
}
// Topic + log line for a WhatsApp message with no Telegram equivalent.
// Names the FRIENDLY type ("poll vote"), keeps the raw proto key
// ("pollUpdateMessage") for precise reports, adds the sender + WA id when
// known, and appends a one-line content preview when one can be extracted:
//
//   ⚠️ A WhatsApp poll vote (pollUpdateMessage) from Alice has no Telegram
//   equivalent - it didn't cross. (#3A1F...)
//   > voted: Option B
export function waUnsupportedLine(m: proto.IWebMessageInfo, senderName?: string | null): string {
	try {
		let raw: any = null
		try {
			raw = unwrap(m?.message)
		} catch {
			raw = null
		}
		// deviceSentMessage wraps phone-sent messages from a linked device;
		// the outer key is just an envelope around the real content.
		if (raw?.deviceSentMessage?.message && typeof raw.deviceSentMessage.message === 'object') {
			raw = raw.deviceSentMessage.message
		}
		const keys: string[] = raw && typeof raw === 'object' ? Object.keys(raw) : []
		const contentKeys = keys.filter((k) => !WA_ENVELOPE_KEYS.has(k))
		const primary = contentKeys[0] ?? keys[0] ?? 'unknownMessage'
		const node = raw?.[primary]
		const friendly = WA_UNSUPPORTED_FRIENDLY[primary] ??
			(primary.endsWith('Message')
				? primary.slice(0, -7).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase() ||
					'message'
				: primary)
		const detail = previewUnsupportedContent(primary, node)
		const from = senderName && senderName.trim()
			? ` from ${senderName.trim().slice(0, 60)}`
			: ''
		const id = typeof m?.key?.id === 'string' && m.key.id.length > 0
			? ` (#${m.key.id.length > 10 ? '…' + m.key.id.slice(-6) : m.key.id})`
			: ''
		const head =
			`⚠️ A WhatsApp ${friendly} (${primary})${from} has no Telegram equivalent - it didn't cross.${id}`
		return detail ? `${head}\n> ${detail}` : head
	} catch {
		return `⚠️ A WhatsApp message has no Telegram equivalent - it didn't cross.`
	}
}
