// Topic move between supergroups - create, replay, repoint, retire.
//
// Telegram has no move-topic API, so a move always means: open a fresh
// topic in the target group, optionally replay recent history, repoint the
// mapping, then close the old topic with a pointer. Business moves start clean (no replay); personal moves replay up to
// PERSONAL_REPLAY_CAP newest mapped messages, oldest-first, re-threading
// replies whose target was also copied. Uncopied rows keep their old
// group, so edits/deletes of pre-move messages still land correctly.
import { chatOfBucket } from './routing.ts'
import { createForumTopic, sanitizeTopicName } from './chat.ts'
import { relayCtx, tgCall } from './state.ts'
import type { Bucket } from '../db.ts'

export const PERSONAL_REPLAY_CAP = 100

export interface MoveResult {
	moved: boolean
	chatId: string
	topicId: number
	copied: number
	skipped: number
}

export async function moveTopic(
	jid: string,
	bucket: Exclude<Bucket, 'undecided'>,
): Promise<MoveResult | null> {
	const { db, tg, groups } = relayCtx
	if (!db || !tg) return null
	const mapping = db.getByJidOrAlias(jid)
	// Muted chats stay put - moving a silenced chat would spend topics and
	// replay budget to relocate a conversation the owner hid on purpose.
	if (!mapping || mapping.archived || mapping.muted) return null
	const fromChat = mapping.telegram_chat_id || groups.personal
	const toChat = chatOfBucket(bucket, groups)
	if (fromChat === toChat) {
		// Same group (single-group mode or already home) - stamp the
		// bucket, never open a second topic.
		db.setBucket(jid, bucket)
		db.setPromptMsgId(jid, null)
		return {
			moved: false,
			chatId: toChat,
			topicId: mapping.telegram_topic_id,
			copied: 0,
			skipped: 0,
		}
	}
	const toTopic = await createForumTopic(
		mapping.display_name,
		mapping.chat_type === 'group',
		toChat,
	)
	const { copied, skipped } = bucket === 'personal'
		? await replayHistory(jid, fromChat, toChat, toTopic)
		: { copied: 0, skipped: 0 }
	db.getOrCreate(jid, toTopic, mapping.display_name, mapping.chat_type, toChat)
	db.setBucket(jid, bucket)
	db.setPromptMsgId(jid, null)
	await retireOldTopic(fromChat, mapping.telegram_topic_id, mapping.display_name, bucket)
	const summary = bucket === 'business'
		? `📦 Moved to Business - fresh topic (history stays in Personal)`
		: `📦 Moved to Personal - replayed ${copied} recent message${copied === 1 ? '' : 's'}` +
			(skipped > 0 ? ` (${skipped} skipped)` : '')
	await tgCall(
		() => tg!.api.sendMessage(toChat, summary, { message_thread_id: toTopic }),
		'notice',
	).catch(() => null)
	return { moved: true, chatId: toChat, topicId: toTopic, copied, skipped }
}

// Copy the newest mapped messages into the new topic, oldest-first. Each
// copied row is rewritten onto its new ID so quotes/edits/deletes keep
// resolving; anything Telegram refuses to copy (service messages, polls
// in some states, deleted originals) counts as skipped, never fatal.
async function replayHistory(
	jid: string,
	fromChat: string,
	toChat: string,
	toTopic: number,
): Promise<{ copied: number; skipped: number }> {
	const { db, tg } = relayCtx
	let copied = 0
	let skipped = 0
	if (!db || !tg) return { copied, skipped }
	const rows = db.recentReplyMaps(jid, PERSONAL_REPLAY_CAP).reverse()
	const remapped = new Map<number, number>()
	for (const row of rows) {
		try {
			// Copy from the row's own group, not the mapping's: clean-cut
			// moves leave rows behind in the previous group, and those
			// messages still exist there to copy from.
			const srcChat = row.tg_chat_id || fromChat
			const replyTo = row.tg_reply_to ? remapped.get(row.tg_reply_to) : undefined
			const sent = await tgCall(
				() =>
					tg!.api.copyMessage(toChat, srcChat, row.tg_msg_id, {
						message_thread_id: toTopic,
						...(replyTo
							? {
								reply_parameters: {
									message_id: replyTo,
									allow_sending_without_reply: true,
								},
							}
							: {}),
					}),
				'move-copy',
			) as { message_id: number }
			if (!sent?.message_id) {
				skipped++
				continue
			}
			remapped.set(row.tg_msg_id, sent.message_id)
			db.moveReplyMap(srcChat, row.tg_msg_id, toChat, sent.message_id)
			copied++
		} catch {
			skipped++
		}
	}
	return { copied, skipped }
}

// Leave a pointer in the old topic, then close and rename it so the move
// direction stays visible. Pointer first - closed topics take no messages.
async function retireOldTopic(
	fromChat: string,
	fromTopic: number,
	displayName: string,
	bucket: Exclude<Bucket, 'undecided'>,
): Promise<void> {
	const { tg } = relayCtx
	if (!tg) return
	const label = bucket === 'business' ? 'Business' : 'Personal'
	await tgCall(
		() =>
			tg!.api.sendMessage(fromChat, `📦 This chat moved to ${label} - continue there.`, {
				message_thread_id: fromTopic,
			}),
		'notice',
	).catch(() => null)
	await tgCall(() => tg!.api.closeForumTopic(fromChat, fromTopic), 'close-topic').catch(() =>
		null
	)
	const name = sanitizeTopicName(`moved ${displayName}`)
	await tgCall(
		() => tg!.api.editForumTopic(fromChat, fromTopic, { name }).catch(() => false),
		'edit-topic',
	).catch(() => null)
}
