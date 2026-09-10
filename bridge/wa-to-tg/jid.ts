// Canonical WA chat JIDs - one contact, one mapping, in one place.
//
// A 1:1 DM can arrive as `xxx@lid` or `yyy@s.whatsapp.net` depending on
// addressing mode (Baileys exposes the other side as `remoteJidAlt`).
// Keying mappings by the raw remoteJid splits one person into two topics,
// so every bridge path canonicalizes first: prefer the PN when either side
// has it, else the normalized primary. Async PN resolution via lidMapping
// covers sightings where the server sent no alt at all.
import { jidNormalizedUser } from 'baileys'
import bot from '@plugin/bot.ts'

export function normalizeJid(jid: string | undefined | null): string {
	if (!jid || typeof jid !== 'string') return ''
	try {
		return jidNormalizedUser(jid)
	} catch {
		return jid
	}
}

// True for phone-number user JIDs (the stable canonical form for DMs).
export function isPnJid(jid: string): boolean {
	return jid.endsWith('@s.whatsapp.net')
}

// True for group chat JIDs (never have LID/PN variants).
export function isGroupJid(jid: string): boolean {
	return jid.endsWith('@g.us')
}

// Alt JIDs Baileys attaches for the same chat (LID<->PN pair).
// Group chats never merge sender alts: participantAlt identifies the
// message author, not the chat, so storing it as a chat alias poisons
// jid_aliases (user PN -> group) and later heals steal the group topic.
export function altJidsOf(key: {
	remoteJid?: string | null
	remoteJidAlt?: string | null
	participantAlt?: string | null
}): string[] {
	const primary = normalizeJid(key?.remoteJid)
	if (isGroupJid(primary)) return []
	const alts: string[] = []
	for (const raw of [key?.remoteJidAlt, key?.participantAlt]) {
		const n = normalizeJid(raw)
		if (n && !isGroupJid(n) && n !== primary) alts.push(n)
	}
	return [...new Set(alts)]
}

// Sync pick: PN wins when either side has it, groups pass through.
export function pickCanonical(primary: string, alts: string[]): string {
	if (primary.endsWith('@g.us')) return primary
	if (isPnJid(primary)) return primary
	for (const a of alts) {
		if (isPnJid(a)) return a
	}
	return primary
}

// Sync candidates for hot paths (edits/deletes/reactions): every known
// variant of this chat, so alias-aware DB lookups hit pre-migration rows.
// Group chats resolve to the group only - the participant is the author,
// never an alias of the chat.
export function candidatesOf(key: {
	remoteJid?: string | null
	remoteJidAlt?: string | null
	participant?: string | null
	participantAlt?: string | null
}): string[] {
	const primary = normalizeJid(key?.remoteJid)
	if (isGroupJid(primary)) return [primary].filter(Boolean)
	const alts = altJidsOf(key)
	const participant = normalizeJid(key?.participant)
	const extra = participant && !isGroupJid(participant) && participant !== primary
		? [participant]
		: []
	return [...new Set([pickCanonical(primary, alts), primary, ...alts, ...extra].filter(Boolean))]
}

// Full canonical JID for an incoming key. Falls back to lidMapping when
// the server sent a bare LID with no alt (first sighting of a contact).
// Group keys stay on the group JID with no sender aliases.
export async function canonicalChatJid(
	key: {
		remoteJid?: string | null
		remoteJidAlt?: string | null
		participantAlt?: string | null
	},
): Promise<{ canonical: string; aliases: string[] }> {
	const primary = normalizeJid(key?.remoteJid)
	const alts = altJidsOf(key)
	let canonical = pickCanonical(primary, alts)
	if (!canonical.endsWith('@lid')) return { canonical, aliases: [primary, ...alts] }
	try {
		const pn = await (bot.sock as any)?.signalRepository?.lidMapping?.getPNForLID(canonical)
		const norm = normalizeJid(pn)
		if (norm && isPnJid(norm)) canonical = norm
	} catch {
		// Mapping unknown yet - the next sighting with an alt heals it.
	}
	const aliases = [...new Set([primary, ...alts, canonical].filter(Boolean))]
	return { canonical, aliases }
}
