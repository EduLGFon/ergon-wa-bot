// Topic mapping ensure - one chat, one forum topic, in one place.
//
// Concurrent upserts for the same new chat await the in-flight creation
// instead of opening a second topic. The lock is keyed by every known
// LID/PN variant, so a bare-LID and a PN+alt sighting collapse onto one
// creation. LID/PN variants heal onto the canonical JID (keeping the
// existing topic, never downgrading PN to LID), outgoing messages never
// rename, and real contact renames update the Telegram topic title too.
import { createForumTopic, sanitizeTopicName } from './chat.ts'
import { inflightTopics, relayCtx, tgCall } from './state.ts'
import { chatForMapping, chatOfBucket } from './routing.ts'
import type { BridgeDB, MappingRow } from '../db.ts'
import { isPnJid } from './jid.ts'

function variantsOf(jid: string, aliases: string[] = []): string[] {
	return [...new Set([jid, ...aliases].filter(Boolean))]
}

function findMapping(db: BridgeDB, variants: string[]): MappingRow | undefined {
	for (const variant of variants) {
		const mapping = db.getByJidOrAlias(variant)
		if (mapping) return mapping
	}
	return undefined
}

// Fold an active row stored under the other LID/PN variant onto this
// sighting. PN is always the survivor: a bare LID must attach to it, never
// rewrite it. Returns the surviving row, or undefined when there is
// nothing to heal (normal create/refresh flow).
function adoptExisting(
	db: BridgeDB,
	jid: string,
	variants: string[],
	chatType: '1:1' | 'group',
): MappingRow | undefined {
	const direct = db.getByJid(jid)
	const own = direct && !direct.archived ? direct : undefined
	const candidates: MappingRow[] = []
	for (const variant of variants) {
		const known = db.getByJidOrAlias(variant)
		if (!known || known.archived || known.whatsapp_jid === jid) continue
		if (known.chat_type !== chatType) continue
		// Only LID<->PN pairs are the same chat. Same-domain rows are
		// different contacts (or poison) and must never be merged.
		if (isPnJid(known.whatsapp_jid) === isPnJid(jid)) continue
		candidates.push(known)
	}
	if (candidates.length === 0) return undefined
	const pn = candidates.find((candidate) => isPnJid(candidate.whatsapp_jid))
	if (pn && !isPnJid(jid)) {
		if (own) db.mergeDuplicateMapping(jid, pn.whatsapp_jid)
		db.addAlias(jid, pn.whatsapp_jid)
		db.repointReplies(jid, pn.whatsapp_jid)
		db.updateLastActive(pn.whatsapp_jid)
		return db.getByJid(pn.whatsapp_jid) ?? pn
	}
	for (const known of candidates) {
		if (own) {
			db.mergeDuplicateMapping(known.whatsapp_jid, jid)
			continue
		}
		const old = known.whatsapp_jid
		db.delete(old)
		db.getOrCreate(
			jid,
			known.telegram_topic_id,
			known.display_name,
			known.chat_type,
			known.telegram_chat_id,
		)
		db.addAlias(old, jid)
		for (const alias of variants) db.addAlias(alias, jid)
		db.repointReplies(old, jid)
		// A healed row is still the same chat - keep its bucket and prompt
		// state so classification is never asked twice.
		db.setBucket(jid, known.bucket)
		db.setPromptMsgId(jid, known.prompt_msg_id)
		if (known.muted) db.setMuted(jid, true)
		db.updateLastActive(jid)
		return db.getByJid(jid) ?? known
	}
	db.updateLastActive(jid)
	return own
}

// Ensure a forum topic mapping exists - creates or refreshes it, updates
// activity and returns null when muted so the caller skips silently.
// `canRename` is false for outgoing (fromMe) messages so our own pushName
// never clobbers the contact name; `aliases` registers every seen LID/PN
// variant onto the canonical JID. New chats open in the default (personal)
// group; the returned chatId is where every follow-up send must go.
// `isNew` is true only when the topic was created by this call, so the
// caller can post one-off new-topic extras (profile card) without
// backfilling pre-existing chats.
export async function ensureTopicMapping(
	jid: string,
	displayName: string,
	chatType: '1:1' | 'group',
	isGroup: boolean,
	opts: { canRename?: boolean; aliases?: string[] } = {},
): Promise<{ topicId: number; chatId: string; isNew: boolean } | null> {
	const variants = variantsOf(jid, opts.aliases)
	const pending = variants.map((variant) => inflightTopics.get(variant)).find(Boolean)
	if (pending) {
		const { topicId } = await pending
		const { db, groups } = relayCtx
		if (!db) return null
		const mapping = adoptExisting(db, jid, variants, chatType) ?? findMapping(db, variants)
		if (!mapping || mapping.muted) return null
		return {
			topicId: mapping.telegram_topic_id ?? topicId,
			chatId: mapping.telegram_chat_id || groups.personal,
			isNew: false,
		}
	}
	const task = createOrRefreshMapping(jid, displayName, chatType, isGroup, opts)
	for (const variant of variants) inflightTopics.set(variant, task)
	try {
		const { topicId, isNew } = await task
		const { db, groups } = relayCtx
		if (!db) return null
		const mapping = findMapping(db, variants)
		if (!mapping || mapping.muted) return null
		return {
			topicId: mapping.telegram_topic_id ?? topicId,
			chatId: mapping.telegram_chat_id || groups.personal,
			isNew,
		}
	} finally {
		for (const variant of variants) {
			if (inflightTopics.get(variant) === task) inflightTopics.delete(variant)
		}
	}
}

async function createOrRefreshMapping(
	jid: string,
	displayName: string,
	chatType: '1:1' | 'group',
	isGroup: boolean,
	opts: { canRename?: boolean; aliases?: string[] },
): Promise<{ topicId: number; isNew: boolean }> {
	const { db, tg, groups } = relayCtx
	if (!db) throw new Error('Bridge DB not initialized')
	const canRename = opts.canRename ?? true
	const variants = variantsOf(jid, opts.aliases)
	const rememberAliases = (canonical: string): void => {
		for (const alias of variants) db.addAlias(alias, canonical)
	}
	// Heal a mapping stored under a previous LID/PN variant: keep the
	// existing topic, move the row and its replies onto the canonical JID
	// instead of creating a dupe. Cross-kind heals (group <-> DM) and
	// same-domain rows are never legitimate - a poisoned alias must not let
	// a group steal a DM topic or merge two different contacts.
	const healed = adoptExisting(db, jid, variants, chatType)
	if (healed) {
		rememberAliases(healed.whatsapp_jid)
		db.updateLastActive(healed.whatsapp_jid)
		return { topicId: healed.telegram_topic_id, isNew: false }
	}
	let mapping = findMapping(db, variants)
	if (!mapping || mapping.archived) {
		// Reactivated chats reopen where their bucket lives - a business
		// chat unarchived into the personal group would split-brain the
		// mapping (bucket business, topic personal).
		const home = !mapping || mapping.bucket === 'undecided'
			? groups.personal
			: chatOfBucket(mapping.bucket, groups)
		const target = mapping?.whatsapp_jid ?? jid
		const freshTopicId = await createForumTopic(displayName, isGroup, home)
		mapping = db.getOrCreate(target, freshTopicId, displayName, chatType, home)
		rememberAliases(target)
		return { topicId: mapping.telegram_topic_id, isNew: true }
	}
	const canonical = mapping.whatsapp_jid
	rememberAliases(canonical)
	if (mapping.display_name !== displayName) {
		if (!canRename) {
			db.updateLastActive(canonical)
			return { topicId: mapping.telegram_topic_id, isNew: false }
		}
		mapping = db.getOrCreate(
			canonical,
			mapping.telegram_topic_id,
			displayName,
			chatType,
			mapping.telegram_chat_id,
		)
		if (tg) {
			const home = chatForMapping(mapping, groups)
			await tgCall(
				() =>
					tg!.api.editForumTopic(
						home,
						mapping!.telegram_topic_id,
						{
							name: sanitizeTopicName(displayName) || mapping!.display_name,
						},
					).catch(() => false),
				'edit-topic',
				home,
			)
		}
	} else {
		db.updateLastActive(canonical)
	}
	return { topicId: mapping.telegram_topic_id, isNew: false }
}
