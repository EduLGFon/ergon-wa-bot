// Chat and group helpers - names, topics and membership lines in one place.
//
// Each WhatsApp chat mirrors to its own forum topic - this resolves display
// names (with caching), creates topics through the flood queue and relays
// membership and subject changes as service lines.
import { cacheGroupName, groupNameCache, relayCtx, tgCall } from './state.ts'
import { chatForMapping } from './routing.ts'
import { phoneOf } from './text.ts'
import bot from '@plugin/bot.ts'

export async function resolveChatName(
	jid: string,
	pushName: string | undefined | null,
	isGroup: boolean,
	fromMe = false,
): Promise<string> {
	if (isGroup) {
		const cached = groupNameCache.get(jid)
		if (cached) return cached
		try {
			const meta = await bot.sock.groupMetadata(jid)
			if (meta?.subject) {
				cacheGroupName(jid, meta.subject)
				return meta.subject
			}
		} catch {
			// fall through to pushName/phone
		}
		// Own pushName is never a group title - use the group id instead.
		const fallback = (!fromMe && pushName) || jid.split('@')[0]
		cacheGroupName(jid, fallback)
		return fallback
	}
	// Outgoing 1:1 messages carry our own pushName, not the peer's - fall
	// back to the phone number so a self-initiated chat is not titled
	// after ourselves. The peer's reply renames it via canRename below.
	if (fromMe) return phoneOf(jid) || jid.split('@')[0]
	return pushName || phoneOf(jid) || jid.split('@')[0]
}

// Telegram topic titles reject invisible-only names (TOPIC_TITLE_EMPTY):
// strip zero-width/format chars (ZWSP, ZWJ, BOM, Hangul filler U+3164, soft
// hyphen...) after the existing newline/space cleanup, defaulting to the
// caller's 'Unknown' when nothing readable remains.
const INVISIBLE_RE = /[\u200B-\u200F\u2060\uFEFF\u3164\u00AD]/g

export function sanitizeTopicName(name: string): string {
	return (name || '').replace(/[\n\r]+/g, ' ').replace(INVISIBLE_RE, '').trim().slice(0, 128)
}

export async function createForumTopic(
	displayName: string,
	_isGroup: boolean,
	chatId: string,
): Promise<number> {
	const { tg } = relayCtx
	if (!tg) throw new Error('Telegram bot not initialized')
	const name = sanitizeTopicName(displayName) || 'Unknown'
	// Topic creation is a Bot API call like any other - it goes through the
	// limiter so a burst of new chats can't flood the supergroup budget.
	const topic = await tgCall(() => tg!.api.createForumTopic(chatId, name), 'new-topic')
	return topic.message_thread_id
}

// Group membership changes -> service lines in the topic.
export async function handleGroupParticipants(upd: {
	id: string
	participants: (string | { id?: string })[]
	action: string
}): Promise<void> {
	const { db, limiter, tg, groups } = relayCtx
	if (!db || !limiter || !tg) return
	try {
		const mapping = db?.getByJidOrAlias(upd.id)
		if (!mapping || mapping.archived || mapping.muted) return
		const names = (upd.participants || [])
			.map((p) => phoneOf(typeof p === 'string' ? p : p?.id) || 'someone')
			.join(', ')
		let line: string | null = null
		switch (upd.action) {
			case 'add':
				line = `👋 ${names} joined the group`
				break
			case 'remove':
				line = `🚪 ${names} left the group`
				break
			case 'promote':
				line = `⭐ ${names} is now an admin`
				break
			case 'demote':
				line = `◽ ${names} is no longer an admin`
				break
			default:
				return
		}
		await tgCall(() =>
			tg!.api.sendMessage(chatForMapping(mapping, groups), line!, {
				message_thread_id: mapping.telegram_topic_id,
			}), 'service-line')
	} catch (e) {
		console.error('[BRIDGE] failed to relay group participants:', e)
	}
}

// Group subject changes -> rename mapping + topic (best effort).
export async function handleGroupUpdates(
	updates: Partial<{ id: string; subject: string }>[],
): Promise<void> {
	const { db, limiter, tg, groups } = relayCtx
	if (!db || !limiter || !tg) return
	for (const u of updates || []) {
		try {
			if (!u?.id || !u.subject) continue
			const mapping = db.getByJidOrAlias(u.id)
			if (!mapping || mapping.archived || mapping.muted) continue
			if (mapping.display_name === u.subject) continue
			cacheGroupName(u.id, u.subject)
			db.getOrCreate(
				u.id,
				mapping.telegram_topic_id,
				u.subject,
				mapping.chat_type,
				mapping.telegram_chat_id,
			)
			await tgCall(
				() =>
					tg!.api.editForumTopic(
						chatForMapping(mapping, groups),
						mapping.telegram_topic_id,
						{
							name: sanitizeTopicName(u.subject!) || mapping.display_name,
						},
					).catch(() => false),
				'edit-topic',
			)
		} catch (e) {
			console.error('[BRIDGE] failed to relay group update:', e)
		}
	}
}
