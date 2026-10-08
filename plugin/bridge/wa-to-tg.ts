// WhatsApp → Telegram relay.
//
// IMPORTANT: this module does NOT open its own WhatsApp connection. A second
// Baileys socket sharing the same auth state fights the main bot for the
// session (stream conflict / repeated logouts). Instead we piggyback on the
// already-running bot singleton from @plugin/bot.ts.
//
// Call `attachWaRelay()` AFTER `loadEvents()` in wa.ts - loadEvents() calls
// removeAllListeners() per event, so attaching earlier would wipe our hook.
//
// Thin facade - all logic lives in ./wa-to-tg/*.ts, this only preserves the
// public API so bridge/mod.ts keeps working unchanged.
export type {
	WaSpecial,
	WaSpecialContact,
	WaSpecialLocation,
	WaSpecialPoll,
} from './wa-to-tg/special.ts'
export { annotateMentions, getMentionedJids, jidPhone } from './wa-to-tg/text.ts'
export { waBytes, waDownloadFailureLine } from './wa-to-tg/media-utils.ts'
export { classifyEditError, routeEdit } from './wa-to-tg/errors.ts'
export { waReactionToTgEmoji } from './wa-to-tg/reactions.ts'
export { waUnsupportedLine } from './wa-to-tg/unsupported.ts'
export { getSpecialContent } from './wa-to-tg/special.ts'
export { isAlbumEligible } from './wa-to-tg/album.ts'
export type { WaDownload } from './wa-to-tg/media.ts'
export { attachWaRelay } from './wa-to-tg/relay.ts'
export { getQuoteInfo } from './wa-to-tg/quote.ts'
export type { WaQuote } from './wa-to-tg/quote.ts'
export { formatBytes } from './format.ts'
