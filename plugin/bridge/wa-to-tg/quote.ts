// WhatsApp quote helpers - resolve replies without deep-search mistakes.
//
// Quotes live on the unwrapped top-level node only - a nested quote inside a
// quote must never be mistaken for the outer one, so contextInfo is read
// directly and the fallback header keeps context when the original was never
// bridged.
import { getMsgText, phoneOf, unwrap } from './text.ts'
import type { BridgeDB } from '../db.ts'
import type { proto } from 'baileys'

export interface WaQuote {
	stanzaId: string
	preview: string
	author: string
}

// Extract the WhatsApp quote (contextInfo) from an incoming message, if any.
// Reads contextInfo off the unwrapped top-level content node directly -
// never a deep search - so a nested quote-inside-a-quote can't be mistaken
// for the outer one. (findKey also skips quotedMessage subtrees, which is
// why getMsgText above returns the reply's own text, not the quoted text.)
export function getQuoteInfo(m: proto.IWebMessageInfo, fallbackAuthor: string): WaQuote | null {
	try {
		const raw = unwrap(m.message)
		if (!raw || typeof raw !== 'object') return null
		let ctx: any = null
		for (const value of Object.values(raw)) {
			if (value && typeof value === 'object' && (value as any).contextInfo?.stanzaId) {
				ctx = (value as any).contextInfo
				break
			}
		}
		if (!ctx) return null
		return {
			stanzaId: String(ctx.stanzaId),
			preview: describeQuoted(ctx.quotedMessage),
			author: ctx.participant ? phoneOf(ctx.participant) : fallbackAuthor,
		}
	} catch {
		return null
	}
}

// WhatsApp quote -> Telegram reply. Resolve the quoted stanzaId to the
// Telegram message mirroring the original; when the original was never
// bridged (history, pruned) fall back to a quote-styled header so context
// isn't silently lost. The target must live in the destination group - a
// row stranded in the other group by a topic move also falls back to the
// header, otherwise the reply would attach to an unrelated message that
// happens to share the numeric ID.
export function resolveQuoteTarget(
	db: BridgeDB,
	jid: string,
	m: proto.IWebMessageInfo,
	displayName: string,
	aliases: string[] = [],
	chatId = '',
): { replyToTgId: number | null; quoteHeader: string | null } {
	const quote = getQuoteInfo(m, displayName)
	if (!quote) return { replyToTgId: null, quoteHeader: null }
	const target = db.getByWaMsgIdAny(quote.stanzaId, [jid, ...aliases])
	if (target && (!chatId || !target.tg_chat_id || target.tg_chat_id === chatId)) {
		return { replyToTgId: target.tg_msg_id, quoteHeader: null }
	}
	return { replyToTgId: null, quoteHeader: `↩️ ${quote.author}: ${quote.preview}` }
}

// Short human-readable summary of the quoted original for the fallback
// header (used only when the original was never bridged to Telegram).
export function describeQuoted(quotedMessage: any): string {
	if (quotedMessage && typeof quotedMessage === 'object') {
		const text = getMsgText(quotedMessage as proto.IMessage)
		if (text) return text.length > 200 ? text.slice(0, 200) + '…' : text
		const key = Object.keys(quotedMessage)[0] || ''
		if (key.includes('image')) return '📷 a photo'
		if (key.includes('video')) return '🎥 a video'
		if (key.includes('audio')) return '🎵 an audio message'
		if (key.includes('sticker')) return 'a sticker'
		if (key.includes('document')) return '📄 a document'
		if (key.includes('location')) return '📍 a location'
		if (key.includes('contact')) return '👤 a contact'
		if (key.includes('poll')) return '📊 a poll'
	}
	return 'a message'
}
