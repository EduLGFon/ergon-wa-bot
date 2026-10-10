// Group member source - metadata cache plus labels in one place.
//
// The member list comes from WhatsApp `groupMetadata` (full roster even for
// 1000+ groups, one query, cached 60s), display names from the learned
// speaker directory with a phone fallback. Search matching is a pure
// function so it stays testable without a socket.
import { resolveContactName } from '../wa-to-tg/contact-names.ts'
import { phoneOf } from '../wa-to-tg/text.ts'
import bot from '@plugin/bot.ts'

export interface MemberItem {
	jid: string
	label: string
	phone: string
	admin: boolean
	// Verified phone-number JID from groupMetadata (present when the roster
	// id is an @lid). Lets Start-chat reach LID members whose PN was never
	// learned into the local LID mapping store.
	pn: string
}

// Bare roster cache: one metadata fetch serves every page turn and search
// keystroke for a minute, so browsing a 1000+ group never hammers WA.
const META_TTL_MS = 60_000
const metaCache = new Map<string, {
	at: number
	subject: string
	parts: { jid: string; admin: boolean; pn: string }[]
}>()

async function rosterOf(groupJid: string): Promise<
	{
		subject: string
		parts: { jid: string; admin: boolean; pn: string }[]
	} | null
> {
	const now = Date.now()
	const hit = metaCache.get(groupJid)
	if (hit && now - hit.at < META_TTL_MS) return hit
	try {
		const meta = await bot.sock.groupMetadata(groupJid)
		if (!meta) return null
		const parts = (meta.participants || []).map((p: any) => ({
			jid: String(typeof p === 'string' ? p : p?.id || ''),
			admin: !!(typeof p !== 'string' && (p?.admin === 'admin' || p?.admin === 'superadmin')),
			pn: String(typeof p === 'string' ? '' : p?.phoneNumber || ''),
		})).filter((p) => !!p.jid)
		const entry = { at: now, subject: String(meta.subject || 'Group'), parts }
		metaCache.set(groupJid, entry)
		if (metaCache.size > 50) {
			const oldest = metaCache.keys().next().value
			if (oldest !== undefined) metaCache.delete(oldest)
		}
		return entry
	} catch {
		return null
	}
}

// Full labeled roster, admins first then alphabetical. Labels resolve once
// per menu open and ride the session, so page turns never re-query.
export async function loadGroupMembers(
	groupJid: string,
): Promise<{ subject: string; items: MemberItem[] } | null> {
	const roster = await rosterOf(groupJid)
	if (!roster) return null
	const items = await Promise.all(roster.parts.map(async (p) => {
		// LID ids are not dialable - show and match the verified PN the
		// server sent alongside the roster entry when it has one.
		const phone = p.jid.endsWith('@lid') && p.pn ? phoneOf(p.pn) : phoneOf(p.jid)
		let label: string | null = null
		try {
			label = await resolveContactName(p.jid)
		} catch {
			label = null
		}
		return {
			jid: p.jid,
			label: label || phone || p.jid.split('@')[0],
			phone,
			admin: p.admin,
			pn: p.pn,
		}
	}))
	items.sort((a, b) => Number(b.admin) - Number(a.admin) || a.label.localeCompare(b.label))
	return { subject: roster.subject, items }
}

// Substring match on names plus digit match on phones. Empty query lists all.
export function filterMembers(items: MemberItem[], query: string): MemberItem[] {
	const q = query.toLowerCase().trim()
	if (!q) return items
	const digits = q.replace(/\D/g, '')
	return items.filter((m) =>
		m.label.toLowerCase().includes(q) ||
		(digits.length >= 3 && m.phone.replace(/\D/g, '').includes(digits))
	)
}
