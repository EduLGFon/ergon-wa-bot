// Learned member names - speaker JID to display name in one place.
//
// WhatsApp mention tokens often carry a bare phone number (@1234567890),
// which relays terribly. Every relayed group message teaches this directory
// its speaker (participant JID to pushName), so later mentions of that
// member render as @Name instead. Learned only: the owner's address book is
// never read. Names are sanitized (single line, capped, digit-only rejected)
// and the backing table is LRU-capped, so strangers cannot grow it forever.
import { normalizeJid, stripDevice } from './jid.ts'
import { relayCtx } from './state.ts'
import bot from '@plugin/bot.ts'

// Hot-path cache: group traffic re-resolves the same speakers constantly,
// so memory answers first and SQLite only fills misses.
const MEM_CACHE_CAP = 500
const MAX_NAME_LEN = 32
const memCache = new Map<string, string>()

// Account-level key: device suffixes (`123:4@s.whatsapp.net`) never identify
// anyone, so they are stripped before storing or looking up.
function keyOf(jid: string | undefined | null): string {
	if (!jid || typeof jid !== 'string') return ''
	const n = normalizeJid(stripDevice(jid))
	return n && !n.endsWith('@g.us') ? n : ''
}

function sanitizeName(raw: unknown): string | null {
	if (typeof raw !== 'string') return null
	const name = raw.replace(/[\n\r\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LEN)
	if (!name) return null
	// Digit-only "names" gain nothing over the phone rendering.
	if (/^[\d+\s().-]+$/.test(name)) return null
	return name
}

// Teach the directory one speaker. Cache-first: unchanged names never touch
// SQLite, so the per-message cost is one Map lookup.
export function learnContactName(
	jid: string | undefined | null,
	pushName: string | undefined | null,
): void {
	const key = keyOf(jid)
	if (!key) return
	const name = sanitizeName(pushName)
	if (!name) return
	if (memCache.get(key) === name) return
	memCache.set(key, name)
	if (memCache.size > MEM_CACHE_CAP) {
		const oldest = memCache.keys().next().value
		if (oldest !== undefined) memCache.delete(oldest)
	}
	try {
		relayCtx.db?.setContactName(key, name)
	} catch {
		// Best effort - a lost name only degrades one mention.
	}
}

// LID/PN counterpart of a member JID via the signal store (best effort -
// mentions often arrive as LID while the member spoke as PN, or the reverse).
async function counterpartOf(key: string): Promise<string> {
	try {
		const repo = (bot.sock as any)?.signalRepository?.lidMapping
		if (!repo) return ''
		const other = key.endsWith('@lid')
			? await repo.getPNForLID?.(key)
			: (key.endsWith('@s.whatsapp.net') ? await repo.getLIDForPN?.(key) : '')
		return keyOf(typeof other === 'string' ? other : '')
	} catch {
		return ''
	}
}

// Display name for a mentioned JID, or null when never seen speak. Tries the
// JID itself then its LID/PN counterpart, memory before SQLite.
export async function resolveContactName(
	jid: string | undefined | null,
): Promise<string | null> {
	const key = keyOf(jid)
	if (!key) return null
	const keys = [key]
	const other = await counterpartOf(key)
	if (other && other !== key) keys.push(other)
	for (const k of keys) {
		const hit = memCache.get(k)
		if (hit) return hit
	}
	const db = relayCtx.db
	if (!db) return memCache.get(key) ?? null
	for (const k of keys) {
		try {
			const name = db.getContactName(k)
			if (name) {
				memCache.set(k, name)
				if (memCache.size > MEM_CACHE_CAP) {
					const oldest = memCache.keys().next().value
					if (oldest !== undefined) memCache.delete(oldest)
				}
				return name
			}
		} catch {
			// try the next variant
		}
	}
	return null
}
