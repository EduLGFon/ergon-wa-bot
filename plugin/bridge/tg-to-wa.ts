// Telegram -> WhatsApp relay - facade wiring submodules.
// Sends through the shared WhatsApp socket - thin entry re-exporting API.
import { registerTgEditHandler, registerTgReactionHandler } from './tg-to-wa/handler-events.ts'
import { registerTgPinHandler, registerTgPollAnswerHandler } from './tg-to-wa/handler-events.ts'
import { registerReactionViewHandler } from './wa-to-tg/reaction-summary.ts'
import { registerPollButtonHandlers } from './wa-to-tg/polls.ts'
import { bucketOfChat, type GroupIds, groupIds } from './wa-to-tg/routing.ts'
import { limiterFor } from './wa-to-tg/state.ts'
import { registerBucketHandlers } from './tg-to-wa/buckets.ts'
import { registerTgMessageHandler } from './tg-to-wa/handlers.ts'
import { registerNewCommand } from './tg-to-wa/newchat.ts'
import { registerGroupMenuHandlers } from './tg-to-wa/group-menu.ts'
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
	// TG-side notices route by destination group so business warnings never
	// consume personal budget. Falls back to the personal limiter before boot.
	const tgRoute = <T>(
		fn: () => Promise<T>,
		label = 'send',
		chatId?: string | number,
	): Promise<T> => (limiterFor(chatId) ?? tgLimiter).enqueue(fn, label)
	registerTgCommands(
		tg,
		db,
		inSupergroup,
		tgRoute,
	)
	registerNewCommand(
		tg,
		db,
		tgRoute,
		inSupergroup,
		groups,
	)
	// Command registrations must all come before the terminal message relay
	// below: grammy runs middleware in registration order and the relay never
	// calls next(), so any tg.command registered after it is silently
	// swallowed (the command text relays to WhatsApp instead of answering).
	// This previously broke /new, /personal, /business and /group while the
	// commands in commands.ts kept working. Non-command middlewares only run
	// on their own update types, so their relative order does not matter.
	registerBucketHandlers(tg, db, groups)
	registerGroupMenuHandlers(tg, db, groups, tgRoute, inSupergroup)
	registerReactionViewHandler(tg, groups)
	registerTgReactionHandler(tg, db, waSend, groups)
	registerTgMessageHandler(tg, db, tgLimiter, waSend, groups)
	registerTgEditHandler(tg, db, waSend, groups)
	registerTgPinHandler(tg, db, waSend, groups)
	registerTgPollAnswerHandler(tg, db, waSend, groups, tgLimiter)
	registerPollButtonHandlers(tg, db, groups, waSend)
}
