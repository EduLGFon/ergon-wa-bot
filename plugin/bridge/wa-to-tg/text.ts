// WhatsApp text helpers - unwrap envelopes and resolve mentions in one place.
//
// View-once and ephemeral wrappers hide the real payload, and Telegram cannot
// resolve WhatsApp identities - these pure helpers peel wrappers, extract
// text and annotate mentions so downstream senders stay simple.
import { stripDevice } from './jid.ts'
import { findKey } from '@util/functions.ts'
import type { proto } from 'baileys'

// Peel view-once / ephemeral wrappers so media underneath is reachable.
export function unwrap(message: proto.IMessage | undefined | null): any {
	let node: any = message
	for (let i = 0; i < 4 && node; i++) {
		if (node.viewOnceMessageV2) node = node.viewOnceMessageV2.message
		else if (node.viewOnceMessage) node = node.viewOnceMessage.message
		else if (node.ephemeralMessage) node = node.ephemeralMessage.message
		else if (node.documentWithCaptionMessage) node = node.documentWithCaptionMessage.message
		else break
	}
	return node
}

export function phoneOf(jid: string | undefined | null): string {
	if (!jid) return ''
	const user = jid.split('@')[0].split(':')[0]
	return user ? `+${user}` : ''
}

export function getMsgText(message: proto.IMessage): string {
	for (const key of ['conversation', 'text', 'caption']) {
		const res = findKey(message, key)
		if (res) return String(res).trim()
	}
	return ''
}

// Phone (`+<digits>`) for a mentionable WhatsApp JID, or null for anything
// that isn't a plain phone JID (LIDs, groups, broadcasts, short/invalid).
export function jidPhone(jid: string | undefined | null): string | null {
	if (!jid || typeof jid !== 'string') return null
	const [user, server] = jid.split('@')
	if (server !== 's.whatsapp.net' && server !== 'c.us') return null
	const digits = (user || '').split(':')[0].replace(/\D/g, '')
	if (!/^\d{7,15}$/.test(digits)) return null
	return `+${digits}`
}

// Mentioned JIDs (contextInfo.mentionedJid) off an unwrapped content node.
// Same direct top-level scan as getQuoteInfo - never a deep search.
export function mentionedJidsOf(raw: any): string[] {
	try {
		if (!raw || typeof raw !== 'object') return []
		for (const value of Object.values(raw)) {
			if (value && typeof value === 'object') {
				const list = (value as any).contextInfo?.mentionedJid
				if (Array.isArray(list)) return list.filter((j) => typeof j === 'string')
			}
		}
	} catch {
		// fall through
	}
	return []
}

// Mentioned JIDs of an incoming WhatsApp message.
export function getMentionedJids(m: proto.IWebMessageInfo): string[] {
	try {
		return mentionedJidsOf(unwrap(m.message))
	} catch {
		return []
	}
}

// Span of the owner's @token inside annotated text - the sender turns it
// into a Telegram text_mention entity so the owner actually gets notified.
export interface OwnerMentionSpan {
	start: number
	length: number
}

export interface AnnotatedMentions {
	text: string
	ownerSpans: OwnerMentionSpan[]
}

// Who counts as the owner for mention purposes: normalized owner JIDs to
// match individual mentions against, plus whether the message mentions
// everyone (@all always includes the owner).
export interface MentionOwner {
	jids: string[]
	all: boolean
}

const TOKEN_RE = /@[^@\s.,;:!?)]+/g

// Canonical key for owner comparison - normalize, then strip any device
// suffix on both sides so `123:4@s.whatsapp.net` still matches its mention.
function ownerKey(jid: string | undefined | null): string {
	return stripDevice(typeof jid === 'string' ? jid : '')
}

// True when the message mentions everyone (@all): WhatsApp marks those with
// contextInfo.nonJidMentions instead of a JID entry, so the mentionedJid
// list alone cannot detect them.
export function hasMentionAll(message: proto.IMessage): boolean {
	try {
		const raw = unwrap(message)
		if (!raw || typeof raw !== 'object') return false
		for (const value of Object.values(raw)) {
			if (value && typeof value === 'object') {
				if (Number((value as any).contextInfo?.nonJidMentions) > 0) return true
			}
		}
	} catch {
		// fall through
	}
	return false
}

// Annotate `@name` mentions with the member's phone number: WhatsApp shows
// the contact name but Telegram can't resolve the identity, so
// "hi @John" + mentionedJid 1555@s.whatsapp.net becomes
// "hi @John (+1555...)". Pairs @tokens in order with the JID list (which is
// how WhatsApp orders them); tokens already containing the number and
// unresolvable JIDs pass through untouched. Runs BEFORE entity parsing so
// formatting offsets stay consistent. Owner @tokens are additionally
// reported as spans for text_mention entities.
export function annotateMentions(
	text: string,
	mentionedJids: string[],
	owner?: MentionOwner | null,
): AnnotatedMentions {
	const empty: AnnotatedMentions = { text, ownerSpans: [] }
	if (!text) return empty
	const jids = Array.isArray(mentionedJids) ? mentionedJids : []
	// @all carries no JID entries, so the empty-list shortcut must not fire
	// when the owner could still be mentioned through it.
	if (jids.length === 0 && !owner?.all) return empty
	const ownerSet = new Set((owner?.jids ?? []).map(ownerKey).filter(Boolean))
	const ownerSpans: OwnerMentionSpan[] = []
	let ji = 0
	let out = ''
	let last = 0
	let firstStart = -1
	let firstLen = 0
	TOKEN_RE.lastIndex = 0
	let mt: RegExpExecArray | null
	// Trailing punctuation (,@John, ...) stays outside the token so the phone
	// lands next to the name: "@John, hi" -> "@John (+...), hi".
	while ((mt = TOKEN_RE.exec(text)) !== null) {
		const tok = mt[0]
		out += text.slice(last, mt.index)
		const start = out.length
		if (firstStart < 0) {
			firstStart = start
			firstLen = tok.length
		}
		const jid = ji < jids.length ? jids[ji++] : null
		const phone = jidPhone(jid)
		let tokOut = tok
		if (phone && !tok.replace(/\D/g, '').endsWith(phone.slice(-7))) {
			tokOut = `${tok} (${phone})`
		}
		out += tokOut
		last = mt.index + tok.length
		if (jid && ownerSet.has(ownerKey(jid))) {
			ownerSpans.push({ start, length: tok.length })
		}
	}
	out += text.slice(last)
	// @all includes the owner but adds no JID entry: with no individual
	// owner hit, anchor the ping on the first @token. The notification fires
	// either way - only the highlighted word depends on this choice.
	if (owner?.all && ownerSpans.length === 0 && firstStart >= 0) {
		ownerSpans.push({ start: firstStart, length: firstLen })
	}
	return { text: out, ownerSpans }
}
