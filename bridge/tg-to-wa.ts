// Telegram -> WhatsApp relay - facade wiring submodules.
// Sends through the shared WhatsApp socket - thin entry re-exporting API.
import { registerTgEditHandler, registerTgReactionHandler } from './tg-to-wa/handler-events.ts'
import { registerTgPinHandler, registerTgPollAnswerHandler } from './tg-to-wa/handler-events.ts'
import { bucketOfChat, type GroupIds, groupIds } from './wa-to-tg/routing.ts'
import { registerBucketHandlers } from './tg-to-wa/buckets.ts'
import { registerTgMessageHandler } from './tg-to-wa/handlers.ts'
import { registerNewCommand } from './tg-to-wa/newchat.ts'
import { registerTgCommands } from './tg-to-wa/commands.ts'
import type { RateLimiter } from './rate-limiter.ts'
import { formatBytes } from './format.ts'
import type { BridgeDB } from './db.ts'
import type { Bot } from 'grammy'

export { formatBytes }
export { buildWaContent, restoreWaKey, tgReactionToWaEmoji } from './tg-to-wa/content.ts'
export { convertWebmToStickerWebp, tgDownloadFailureLine } from './tg-to-wa/replies.ts'
export { TG_DOWNLOAD_CAP_BYTES } from './tg-to-wa/media.ts'
export type { TgDownload } from './tg-to-wa/media.ts'

export function registerTgHandlers(
	tg: Bot,
	db: BridgeDB,
	tgLimiter: RateLimiter,
	waLimiter: RateLimiter,
): void {
	const groups: GroupIds = groupIds()
	// One bot serves both forum groups - any update outside them is ignored.
	const inSupergroup = (ctx: { chat?: { id?: string | number } }): boolean =>
		bucketOfChat(ctx.chat?.id ?? '', groups) !== null
	const waSend = <T>(fn: () => Promise<T>): Promise<T> => waLimiter.enqueue(fn, 'wa-send')
	registerTgCommands(
		tg,
		db,
		inSupergroup,
	)
	registerNewCommand(
		tg,
		db,
		(fn, label) => tgLimiter.enqueue(fn, label),
		inSupergroup,
		groups,
	)
	registerTgReactionHandler(tg, db, waSend, groups)
	registerTgMessageHandler(tg, db, tgLimiter, waSend, groups)
	registerTgEditHandler(tg, db, waSend, groups)
	registerTgPinHandler(tg, db, waSend, groups)
	registerTgPollAnswerHandler(tg, db, waSend, groups, tgLimiter)
	registerBucketHandlers(tg, db, groups)
}
