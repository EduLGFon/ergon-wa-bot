// Group metadata TTL cache.
// Baileys issues a live `groupMetadata` IQ query on EVERY group sendMessage
// (see relayMessage in messages-send.js) unless the socket is given a
// `cachedGroupMetadata` callback. A bulk op like `.clean 100` therefore
// fires ~100 metadata queries in about a minute and WhatsApp answers 429
// `rate-overlimit`, aborting the op mid-way. This cache collapses that to
// ~1 query per group per TTL window; on miss/expiry Baileys falls back to
// a live query exactly as before. Kept dependency-free so both the socket
// wrapper (@class/baileys.ts) and getGroup (@db) can share it without
// import cycles. Invalidated by event/groups/update.ts on server changes.
import type { GroupMetadata } from 'baileys'

// 5 minutes: short enough that member/subject changes go stale fast,
// long enough that a bulk op only pays one query per group.
const GROUP_META_TTL_MS = 5 * 60 * 1000
// Bound memory on long-lived processes with many groups.
const GROUP_META_MAX = 100

const groupMetaCache = new Map<str, { meta: GroupMetadata; at: num }>()

function getCachedGroupMeta(jid: str): GroupMetadata | undefined {
	const hit = groupMetaCache.get(jid)
	if (!hit) return undefined
	if (Date.now() - hit.at > GROUP_META_TTL_MS) {
		groupMetaCache.delete(jid)
		return undefined
	}
	return hit.meta
}

function setCachedGroupMeta(jid: str, meta: GroupMetadata): void {
	groupMetaCache.set(jid, { meta, at: Date.now() })
	if (groupMetaCache.size > GROUP_META_MAX) {
		const oldest = groupMetaCache.keys().next().value
		if (oldest !== undefined) groupMetaCache.delete(oldest)
	}
}

// Drop cached group metadata (one group, or the whole cache when no jid).
function dropGroupMetaCache(jid?: str): void {
	if (jid) groupMetaCache.delete(jid)
	else groupMetaCache.clear()
}

export { dropGroupMetaCache, getCachedGroupMeta, setCachedGroupMeta }
