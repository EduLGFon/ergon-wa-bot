// Topic mapping ensure - one chat, one forum topic, in one place.
//
// Concurrent upserts for the same new chat await the in-flight creation
// instead of opening a second topic. LID/PN variants heal onto the
// canonical JID (keeping the existing topic), outgoing messages never
// rename, and real contact renames update the Telegram topic title too.
import { inflightTopics, relayCtx, tgCall } from './state.ts'
import { chatForMapping, chatOfBucket } from './routing.ts'
import { createForumTopic, sanitizeTopicName } from './chat.ts'

// Ensure a forum topic mapping exists - creates or refreshes it, updates
// activity and returns null when muted so the caller skips silently.
// `canRename` is false for outgoing (fromMe) messages so our own pushName
// never clobbers the contact name; `aliases` registers every seen LID/PN
// variant onto the canonical JID. New chats open in the default (personal)
// group; the returned chatId is where every follow-up send must go.
export async function ensureTopicMapping(
	jid: string,
	displayName: string,
	chatType: '1:1' | 'group',
	isGroup: boolean,
	opts: { canRename?: boolean; aliases?: string[] } = {},
): Promise<{ topicId: number; chatId: string } | null> {
	const pending = inflightTopics.get(jid)
	if (pending) {
		const topicId = await pending
		const { db, groups } = relayCtx
		const mapping = db?.getByJidOrAlias(jid)
		if (!mapping || mapping.muted) return null
		return {
			topicId: mapping.telegram_topic_id ?? topicId,
			chatId: mapping.telegram_chat_id || groups.personal,
		}
	}
	const task = createOrRefreshMapping(jid, displayName, chatType, isGroup, opts)
	inflightTopics.set(jid, task)
	try {
		const topicId = await task
		const { db, groups } = relayCtx
		const mapping = db?.getByJidOrAlias(jid)
		if (!mapping || mapping.muted) return null
		return {
			topicId: mapping.telegram_topic_id ?? topicId,
			chatId: mapping.telegram_chat_id || groups.personal,
		}
	} finally {
		if (inflightTopics.get(jid) === task) inflightTopics.delete(jid)
	}
}

async function createOrRefreshMapping(
	jid: string,
	displayName: string,
	chatType: '1:1' | 'group',
	isGroup: boolean,
	opts: { canRename?: boolean; aliases?: string[] },
): Promise<number> {
	const { db, tg, groups } = relayCtx
	if (!db) throw new Error('Bridge DB not initialized')
	const canRename = opts.canRename ?? true
	const rememberAliases = (): void => {
		for (const a of opts.aliases || []) db.addAlias(a, jid)
	}
	// Heal a mapping stored under a previous variant (bare LID first
	// sighting, then PN with alt): keep the existing topic, move the row
	// and its replies onto the canonical JID instead of creating dupe.
	// Cross-kind heals (group <-> DM) are never legitimate - a poisoned
	// alias must not let a group steal a DM topic or vice versa.
	for (const variant of [...new Set([jid, ...(opts.aliases || [])])]) {
		const known = db.getByJidOrAlias(variant)
		if (
			known && !known.archived && known.whatsapp_jid !== jid &&
			known.chat_type === chatType
		) {
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
			db.repointReplies(old, jid)
			// A healed row is still the same chat - keep its bucket and
			// prompt state so classification is never asked twice.
			db.setBucket(jid, known.bucket)
			db.setPromptMsgId(jid, known.prompt_msg_id)
			rememberAliases()
			db.updateLastActive(jid)
			return known.telegram_topic_id
		}
	}
	let mapping = db.getByJidOrAlias(jid)
	if (!mapping || mapping.archived) {
		// Reactivated chats reopen where their bucket lives - a business
		// chat unarchived into the personal group would split-brain the
		// mapping (bucket business, topic personal).
		const home = !mapping || mapping.bucket === 'undecided'
			? groups.personal
			: chatOfBucket(mapping.bucket, groups)
		const freshTopicId = await createForumTopic(displayName, isGroup, home)
		mapping = db.getOrCreate(jid, freshTopicId, displayName, chatType, home)
		rememberAliases()
		return mapping.telegram_topic_id
	}
	rememberAliases()
	if (mapping.display_name !== displayName) {
		if (!canRename) {
			db.updateLastActive(jid)
			return mapping.telegram_topic_id
		}
		mapping = db.getOrCreate(
			jid,
			mapping.telegram_topic_id,
			displayName,
			chatType,
			mapping.telegram_chat_id,
		)
		if (tg) {
			await tgCall(
				() =>
					tg!.api.editForumTopic(
						chatForMapping(mapping!, groups),
						mapping!.telegram_topic_id,
						{
							name: sanitizeTopicName(displayName) || mapping!.display_name,
						},
					).catch(() => false),
				'edit-topic',
			)
		}
	} else {
		db.updateLastActive(jid)
	}
	return mapping.telegram_topic_id
}
