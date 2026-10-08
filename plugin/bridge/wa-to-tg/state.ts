// Relay shared state - Telegram handles and flood queues in one place.
//
// Every WA-TO-TG send funnels through tgCall so flood control stays central -
// submodules import this context instead of holding their own copies.
//
// Personal priority: Telegram throttles per supergroup, and dual setups have
// two independent budgets. Personal and business traffic get SEPARATE
// RateLimiter queues so a business burst (or a business 429 block) never
// stalls personal relay. tgCall routes by destination chatId - pass it at
// every send site that knows it, or the personal lane is used.
import type { RateLimiter } from '../rate-limiter.ts'
import { type GroupIds, groupIds } from './routing.ts'
import type { BridgeDB } from '../db.ts'
import type { Bot } from 'grammy'

export const relayCtx: {
	tg: Bot | null
	db: BridgeDB | null
	limiter: RateLimiter | null
	businessLimiter: RateLimiter | null
	groups: GroupIds
	attachedSock: unknown
	// The owner's Telegram identity for @all/@mention pings - resolved once
	// at boot (env override, else the personal supergroup creator). Null
	// until resolved; owner mentions then stay plain text.
	ownerTg: { id: number; is_bot: boolean; first_name: string } | null
} = {
	tg: null,
	db: null,
	limiter: null,
	businessLimiter: null,
	groups: { personal: '', business: '', legacy: '' },
	attachedSock: null,
	ownerTg: null,
}

export function setRelayCtx(
	tgBot: Bot,
	bridgeDb: BridgeDB,
	personalLimiter: RateLimiter,
	businessLimiter?: RateLimiter,
): void {
	relayCtx.tg = tgBot
	relayCtx.db = bridgeDb
	relayCtx.limiter = personalLimiter
	relayCtx.businessLimiter = businessLimiter ?? personalLimiter
	relayCtx.groups = groupIds()
	// Expose for the HEALTH periodic line without an import cycle.
	try {
		;(globalThis as any).__relayCtxMod = { relayCtx }
	} catch {
		// ignore
	}
	// Single-group DBs predate per-group identity - stamp their rows onto
	// the legacy supergroup so scoped lookups keep resolving.
	bridgeDb.backfillLegacyChat(relayCtx.groups.legacy || relayCtx.groups.personal)
}

export const groupNameCache = new Map<string, string>()
const MAX_NAME_CACHE = 500

// In-flight topic creations by canonical JID. Concurrent upserts for a new
// chat must await the first creation instead of opening a second topic.
export const inflightTopics = new Map<string, Promise<number>>()

export function cacheGroupName(jid: string, name: string): void {
	groupNameCache.set(jid, name)
	if (groupNameCache.size > MAX_NAME_CACHE) {
		const oldest = groupNameCache.keys().next().value
		if (oldest !== undefined) groupNameCache.delete(oldest)
	}
}

// Queue for a destination supergroup: business chat goes to the business
// lane, everything else (personal, unknown, single-group mode) to personal.
// Single-group setups share one instance, so routing is a no-op there.
export function limiterFor(chatId?: string | number): RateLimiter | null {
	const { limiter, businessLimiter, groups } = relayCtx
	if (chatId != null && chatId !== '' && String(chatId) === groups.business) {
		return businessLimiter ?? limiter
	}
	return limiter
}

// Single Telegram API call through the flood-aware queue. EVERY api.*
// call in this module must go through here, so each API call - not each
// logical message - gets its own spacing slot, and 429s pause + retry the
// queue instead of cascading into drops. Pass chatId whenever the call
// site knows the destination supergroup so business traffic stays in its
// own lane; without it the personal lane is used.
export function tgCall<T>(
	fn: () => Promise<T>,
	label = 'send',
	chatId?: string | number,
): Promise<T> {
	const limiter = limiterFor(chatId) ?? relayCtx.limiter
	if (!limiter) return fn()
	return limiter.enqueue(fn, label)
}

// Best-effort ⚠️ notice to the affected topic so a relay failure is visible
// where the user looks, not just in server logs. Never throws and never
// loops: it sends via tg.api directly, and the TG-TO-WA side ignores the bot's
// own messages.
export async function notifyTopic(
	chatId: string | number,
	topicId: number,
	line: string,
): Promise<void> {
	const { tg, limiter } = relayCtx
	if (!tg || !limiter) return
	// Deprioritized during floods: the limiter already pauses the queue on
	// 429, so a burst of failures collapses into delayed notices instead of
	// extra load. A notice that exhausts its flood retries just drops - the
	// server log already has the details.
	try {
		await tgCall(
			() => tg!.api.sendMessage(chatId, line, { message_thread_id: topicId }),
			'notice',
			chatId,
		)
	} catch {
		// The notice itself failed - the server log already has the details.
	}
}

// First line of an error, capped - for topic notices, not logs.
export function shortErr(e: unknown): string {
	const raw = typeof e === 'string'
		? e
		: ((e as { description?: unknown; message?: unknown })?.description ??
			(e as { message?: unknown })?.message ??
			String(e))
	return String(raw).split('\n')[0].slice(0, 160) || 'unknown error'
}
