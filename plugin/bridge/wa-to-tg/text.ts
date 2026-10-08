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

// Resolver turning a mentioned JID into a display name (learned directory).
// Null/missing means "no name known" - the token keeps its old rendering.
export type MentionNameResolver = (
	jid: string,
) => Promise<string | null> | string | null

// Bare-number token: only digits and phone punctuation after the @. These
// are the terrible "@1234567890" renders - the only tokens a resolved name
// ever replaces (readable tokens keep the sender's wording, even nicknames).
const NUMERIC_TOKEN_RE = /^@[\d\s().+-]+$/

// Annotate `@name` mentions with the member's phone number: WhatsApp shows
// the contact name but Telegram can't resolve the identity, so
// "hi @John" + mentionedJid 1555@s.whatsapp.net becomes
// "hi @John (+1555...)". Pairs @tokens in order with the JID list (which is
// how WhatsApp orders them); tokens already containing the number and
// unresolvable JIDs pass through untouched. When a resolver knows the
// member, a bare-number token becomes @Name instead (owner direction).
// Runs BEFORE entity parsing so formatting offsets stay consistent. Owner
// @tokens are additionally reported as spans for text_mention entities.
export async function annotateMentions(
	text: string,
	mentionedJids: string[],
	owner?: MentionOwner | null,
	resolveName?: MentionNameResolver | null,
): Promise<AnnotatedMentions> {
	const empty: AnnotatedMentions = { text, ownerSpans: [] }
	if (!text) return empty
	const jids = Array.isArray(mentionedJids) ? mentionedJids : []
	// @all carries no JID entries, so the empty-list shortcut must not fire
	// when the owner could still be mentioned through it.
	if (jids.length === 0 && !owner?.all) return empty
	const ownerSet = new Set((owner?.jids ?? []).map(ownerKey).filter(Boolean))
	// Pair @tokens with JIDs in order first - name resolution is parallel,
	// output assembly stays sequential so offsets match the final text.
	TOKEN_RE.lastIndex = 0
	const toks: { tok: string; jid: string | null; plain: string }[] = []
	let last = 0
	let ji = 0
	let mt: RegExpExecArray | null
	while ((mt = TOKEN_RE.exec(text)) !== null) {
		toks.push({
			tok: mt[0],
			jid: ji < jids.length ? jids[ji++] : null,
			plain: text.slice(last, mt.index),
		})
		last = mt.index + mt[0].length
	}
	const tail = text.slice(last)
	const names = new Map<string, string>()
	if (resolveName) {
		const uniq = [...new Set(toks.map((t) => t.jid).filter((j): j is string => !!j))]
		const got = await Promise.all(
			uniq.map(async (j) => {
				try {
					return [j, await resolveName(j)] as const
				} catch {
					return [j, null] as const
				}
			}),
		)
		for (const [j, n] of got) {
			if (n) names.set(j, n)
		}
	}
	let out = ''
	const ownerSpans: OwnerMentionSpan[] = []
	let firstStart = -1
	let firstLen = 0
	for (const { tok, jid, plain } of toks) {
		out += plain
		const start = out.length
		// Span covers the mention as finally rendered: the bare token for
		// phone-suffixed and untouched tokens, the @Name for replacements.
		let len = tok.length
		let tokOut = tok
		const phone = jidPhone(jid)
		if (phone && !tok.replace(/\D/g, '').endsWith(phone.slice(-7))) {
			// Trailing punctuation (,@John, ...) stays outside the token so
			// the phone lands next to the name: "@John, hi" ->
			// "@John (+...), hi".
			tokOut = `${tok} (${phone})`
		} else if (resolveName && jid) {
			const known = names.get(jid)
			if (known && NUMERIC_TOKEN_RE.test(tok)) {
				tokOut = `@${known}`
				len = tokOut.length
			}
		}
		if (firstStart < 0) {
			firstStart = start
			firstLen = len
		}
		out += tokOut
		if (jid && ownerSet.has(ownerKey(jid))) {
			ownerSpans.push({ start, length: len })
		}
	}
	out += tail
	// @all includes the owner but adds no JID entry: with no individual
	// owner hit, anchor the ping on the first @token. The notification fires
	// either way - only the highlighted word depends on this choice.
	if (owner?.all && ownerSpans.length === 0 && firstStart >= 0) {
		ownerSpans.push({ start: firstStart, length: firstLen })
	}
	return { text: out, ownerSpans }
}
