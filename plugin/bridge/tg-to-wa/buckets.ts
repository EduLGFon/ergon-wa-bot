// Bucket classification from Telegram - buttons + commands.
//
// The new-chat prompt carries Personal/Business buttons resolving the chat
// through the stored prompt message ID; /personal and /business stay as the
// fallback. Moves run detached (a replay outlasts the callback window), so
// the tap is acknowledged first and the prompt edited on finish.
import { bucketOfChat, chatOfBucket, type GroupIds } from '../wa-to-tg/routing.ts'
import { relayCtx } from '../wa-to-tg/state.ts'
import { moveTopic } from '../wa-to-tg/move.ts'
import type { BridgeDB } from '../db.ts'
import type { Bot } from 'grammy'

type Bucket = 'personal' | 'business'

const LABEL: Record<Bucket, string> = { personal: 'Personal', business: 'Business' }

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
			const promptId = (ctx.callbackQuery?.message as { message_id?: number } | undefined)
				?.message_id
			if (!promptId) {
				await ctx.answerCallbackQuery({ text: 'Use /personal or /business in the topic.' })
					.catch(() => null)
				return
			}
			const mapping = db.getByPrompt(chatId, promptId)
			if (!mapping) {
				const text = 'Chat not found - use /personal or /business.'
				await ctx.answerCallbackQuery({ text }).catch(() => null)
				return
			}
			if (mapping.muted) {
				await ctx.answerCallbackQuery({ text: 'Unmute this chat first.' }).catch(() => null)
				return
			}
			if (mapping.bucket === bucket) {
				const text = `Already in ${LABEL[bucket]}.`
				await ctx.answerCallbackQuery({ text }).catch(() => null)
				return
			}
			await ctx.answerCallbackQuery({ text: `Moving to ${LABEL[bucket]}…` }).catch(() => null)
			void classifyChat(db, mapping.whatsapp_jid, bucket, chatId, promptId).catch((e) =>
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
				const mapping = db.getByTopic(chatId, topicId)
				if (!mapping) {
					await ctx.reply('No bridged chat in this topic.')
					return
				}
				if (mapping.muted) {
					await ctx.reply('Unmute this chat first - muted chats stay put.')
					return
				}
				if (mapping.bucket === bucket) {
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
					console.error('[BRIDGE] bucket command failed:', e)
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
	promptId: number | null,
): Promise<void> {
	const prev = pendingClassifications.get(jid)
	const task = (async () => {
		if (prev) await prev.catch(() => null)
		await runClassify(db, jid, bucket, chatId, promptId)
	})()
	pendingClassifications.set(jid, task)
	task.finally(() => {
		if (pendingClassifications.get(jid) === task) pendingClassifications.delete(jid)
	}).catch(() => null)
	return task
}

// Shared classify path: move, then retire the prompt (buttons) in the old
// topic. Failures land on the prompt when there is one, else as a reply.
// Bot comes from the shared relay context (same instance moveTopic sends
// through) so the two can never diverge.
async function runClassify(
	db: BridgeDB,
	jid: string,
	bucket: Bucket,
	chatId: string,
	promptId: number | null,
): Promise<void> {
	const { tg } = relayCtx
	if (!tg) return
	try {
		const result = await moveTopic(jid, bucket)
		if (!result) throw new Error('move returned no result')
		if (!result.moved) {
			if (promptId) {
				const line = `Already in ${LABEL[bucket]}.`
				await tg!.api.editMessageText(chatId, promptId, line).catch(() => null)
			}
			return
		}
		const done = bucket === 'business'
			? `✅ Business - fresh topic opened.`
			: `✅ Personal - replayed ${result.copied} message${result.copied === 1 ? '' : 's'}` +
				(result.skipped > 0 ? ` (${result.skipped} skipped)` : '') + '.'
		if (promptId) {
			await tg!.api.editMessageText(chatId, promptId, done).catch(() => null)
		}
	} catch (e) {
		console.error('[BRIDGE] classify chat failed:', e)
		const line = `⚠️ Move to ${LABEL[bucket]} failed - try /${bucket} again.`
		if (promptId) {
			await tg!.api.editMessageText(chatId, promptId, line).catch(() => null)
		} else {
			const mapping = db.getByJidOrAlias(jid)
			if (mapping) {
				await tg!.api.sendMessage(chatId, line, {
					message_thread_id: mapping.telegram_topic_id,
				}).catch(() => null)
			}
		}
	}
}
