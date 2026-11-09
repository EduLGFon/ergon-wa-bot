// Bucket classification from Telegram - buttons + commands.
//
// The profile card carries Personal/Business buttons resolving the chat
// through the stored card message ID; /personal and /business stay as the
// fallback. Moves run detached (a replay outlasts the callback window), so
// the tap is acknowledged first and the buttons are stripped on finish.
// Split-brain rows (bucket says one group, telegram_chat_id says the other)
// are repointed to the hosting group before classifying, so "Already in X"
// is only answered when the topic really is in X's home group.
import {
	bucketOfChat,
	chatForMapping,
	chatOfBucket,
	type GroupIds,
	isDual,
} from '../wa-to-tg/routing.ts'
import type { BridgeDB, MappingRow } from '../db.ts'
import { relayCtx } from '../wa-to-tg/state.ts'
import { moveTopic } from '../wa-to-tg/move.ts'
import type { Bot } from 'grammy'

type Bucket = 'personal' | 'business'

const LABEL: Record<Bucket, string> = { personal: 'Personal', business: 'Business' }

// A chat needs a move when its bucket differs OR its topic is hosted
// outside that bucket's home group. The host check is what stops a
// split-brain row (bucket business, topic still personal) from answering
// "Already in Business" without moving anything.
export function needsMove(
	mapping: Pick<MappingRow, 'bucket' | 'telegram_chat_id'>,
	bucket: Bucket,
	groups: GroupIds,
): boolean {
	// Single-group setups host both buckets in one group, so an undecided
	// chat already sits where a personal classification would put it.
	const changed = !isDual(groups) && mapping.bucket === 'undecided'
		? bucket !== 'personal'
		: mapping.bucket !== bucket
	return changed ||
		chatForMapping(mapping, groups) !== chatOfBucket(bucket, groups)
}

// Align a split-brain row with the group that actually hosts its topic.
// Every send goes to telegram_chat_id, so the host group is the only
// reliable evidence: repointing the bucket keeps relay working and makes
// the next /business a real move. Muted and archived rows stay untouched.
export function reconcileSplitBrain(
	db: BridgeDB,
	jid: string,
	groups: GroupIds,
): MappingRow | undefined {
	const mapping = db.getByJidOrAlias(jid)
	if (!mapping || mapping.muted || mapping.archived) return mapping
	// Both buckets share one group, so the host carries no classification
	// signal: repointing would stamp every undecided row as business.
	if (!isDual(groups)) return mapping
	const host = bucketOfChat(mapping.telegram_chat_id, groups)
	if (!host || mapping.bucket === host) return mapping
	// An undecided chat already in the personal group is still waiting for
	// its first classification; only the business host implies a choice.
	if (mapping.bucket === 'undecided' && host === 'personal') return mapping
	db.setBucket(mapping.whatsapp_jid, host)
	return db.getByJid(mapping.whatsapp_jid) ?? mapping
}

export function registerBucketHandlers(tg: Bot, db: BridgeDB, groups: GroupIds): void {
	tg.callbackQuery(/^bucket:(personal|business)$/, async (ctx) => {
		try {
			const chatId = String(ctx.chat?.id ?? '')
			if (bucketOfChat(chatId, groups) === null) {
				await ctx.answerCallbackQuery({ text: 'Unknown group.' }).catch(() => null)
				return
			}
			const bucket = (ctx.match?.[1] === 'business' ? 'business' : 'personal') as Bucket
			if (!chatOfBucket(bucket, groups)) {
				await ctx.answerCallbackQuery({ text: `${LABEL[bucket]} group is not configured.` })
					.catch(() => null)
				return
			}
			const buttonId = (ctx.callbackQuery?.message as { message_id?: number } | undefined)
				?.message_id
			if (!buttonId) {
				await ctx.answerCallbackQuery({ text: 'Use /personal or /business in the topic.' })
					.catch(() => null)
				return
			}
			// Matches the profile card id (or a legacy standalone prompt),
			// so only the live button pair resolves.
			const found = db.getByButtonMsg(chatId, buttonId)
			if (!found) {
				const text = 'Chat not found - use /personal or /business.'
				await ctx.answerCallbackQuery({ text }).catch(() => null)
				return
			}
			const mapping = reconcileSplitBrain(db, found.whatsapp_jid, groups) ?? found
			if (mapping.muted) {
				await ctx.answerCallbackQuery({ text: 'Unmute this chat first.' }).catch(() => null)
				return
			}
			if (!needsMove(mapping, bucket, groups)) {
				const text = `Already in ${LABEL[bucket]}.`
				await ctx.answerCallbackQuery({ text }).catch(() => null)
				return
			}
			await ctx.answerCallbackQuery({ text: `Moving to ${LABEL[bucket]}…` }).catch(() => null)
			void classifyChat(db, mapping.whatsapp_jid, bucket, chatId, buttonId).catch((e) =>
				console.error('[BRIDGE] bucket classification failed:', e)
			)
		} catch (e) {
			console.error('[BRIDGE] bucket button failed:', e)
		}
	})

	for (const bucket of ['personal', 'business'] as Bucket[]) {
		tg.command(bucket, async (ctx) => {
			try {
				const chatId = String(ctx.chat?.id ?? '')
				if (bucketOfChat(chatId, groups) === null) return
				const topicId = (ctx.msg as any)?.message_thread_id
				if (!topicId) return
				const found = db.getByTopic(chatId, topicId)
				if (!found) {
					await ctx.reply('No bridged chat in this topic.')
					return
				}
				const mapping = reconcileSplitBrain(db, found.whatsapp_jid, groups) ?? found
				if (mapping.muted) {
					await ctx.reply('Unmute this chat first - muted chats stay put.')
					return
				}
				if (!needsMove(mapping, bucket, groups)) {
					const text = `Already in ${LABEL[bucket]}.`
					await ctx.reply(text)
					return
				}
				if (!chatOfBucket(bucket, groups)) {
					await ctx.reply(
						`The ${LABEL[bucket]} group is not configured - set it in conf/.env.`,
					)
					return
				}
				await ctx.reply(`Moving to ${LABEL[bucket]}…`)
				void classifyChat(db, mapping.whatsapp_jid, bucket, chatId, null).catch((e) =>
					console.error(`[BRIDGE] /${bucket} command failed:`, e)
				)
			} catch (e) {
				console.error(`[BRIDGE] /${bucket} failed:`, e)
			}
		})
	}
}

// One move per chat at a time - a double-tap (or tap plus command) must
// serialize, never open two topics at once. Chained, not shared: each
// waiter re-reads the mapping after the previous move settles, so the
// last intent wins on fresh state.
const pendingClassifications = new Map<string, Promise<void>>()

function classifyChat(
	db: BridgeDB,
	jid: string,
	bucket: Bucket,
	chatId: string,
	buttonId: number | null,
): Promise<void> {
	const prev = pendingClassifications.get(jid)
	const task = (async () => {
		if (prev) await prev.catch(() => null)
		await runClassify(db, jid, bucket, chatId, buttonId)
	})()
	pendingClassifications.set(jid, task)
	task.finally(() => {
		if (pendingClassifications.get(jid) === task) pendingClassifications.delete(jid)
	}).catch(() => null)
	return task
}

// Shared classify path: repoint any split-brain state, move, then strip the
// buttons off the card. The button message can be a photo (profile card),
// so text is never edited - keyboards strip cleanly off any message kind.
// Business moves delete the old topic outright, so there is nothing left
// to strip there. Failures land as a fresh line, never a throw. Bot comes
// from the shared relay context (same instance moveTopic sends through) so
// the two can never diverge.
async function runClassify(
	db: BridgeDB,
	jid: string,
	bucket: Bucket,
	chatId: string,
	buttonId: number | null,
): Promise<void> {
	const { tg } = relayCtx
	if (!tg) return
	try {
		const mapping = reconcileSplitBrain(db, jid, relayCtx.groups)
		if (!mapping) throw new Error('chat not found')
		const result = await moveTopic(mapping.whatsapp_jid, bucket)
		if (!result) throw new Error('move returned no result')
		if (!result.moved) {
			await stripButtons(chatId, buttonId)
			return
		}
		if (bucket === 'personal') await stripButtons(chatId, buttonId)
	} catch (e) {
		console.error('[BRIDGE] classify chat failed:', e)
		const line = `Move to ${LABEL[bucket]} failed - try /${bucket} again.`
		const mapping = db.getByJidOrAlias(jid)
		if (mapping) {
			await tg!.api.sendMessage(mapping.telegram_chat_id, line, {
				message_thread_id: mapping.telegram_topic_id,
			}).catch(() => null)
		}
	}
}

// Remove the inline keyboard from the button message. Works on photo and
// text messages alike; missing or already-moved messages fail silently.
async function stripButtons(chatId: string, buttonId: number | null): Promise<void> {
	const { tg } = relayCtx
	if (!tg || !buttonId) return
	await tg!.api.editMessageReplyMarkup(chatId, buttonId, undefined).catch(() => null)
}
