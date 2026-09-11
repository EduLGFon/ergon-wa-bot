// Bridge entry point.
//
// Two ways to use it:
//
// 1. Embedded (normal): wa.ts calls `startBridge()` AFTER bot.connect() +
//    loadEvents(). The bridge shares the running WhatsApp socket - no second
//    connection, no auth duplication.
// 2. Standalone helper: `deno run -A bridge/mod.ts -- --find-id` prints the
//    supergroup ID so you can put it in conf/.env. This mode never touches
//    WhatsApp.
import { registerTgHandlers } from './tg-to-wa.ts'
import { groupIds, isDual } from './wa-to-tg/routing.ts'
import { findSupergroupId } from './find-id.ts'
import { RateLimiter } from './rate-limiter.ts'
import { relayCtx } from './wa-to-tg/state.ts'
import { attachWaRelay } from './wa-to-tg.ts'
import { BridgeDB } from './db.ts'
import { Bot } from 'grammy'

export { findSupergroupId }

// Starts the Telegram side and hooks the WA→TG relay onto the shared socket.
// Returns null (instead of throwing) when not configured, so the WhatsApp
// bot always boots even if the bridge env is missing.
let activeBridge: { tg: Bot; db: BridgeDB; tgLimiter: RateLimiter; waLimiter: RateLimiter } | null =
	null

export function reattachBridge(): void {
	if (!activeBridge) return
	attachWaRelay(activeBridge.tg, activeBridge.db, activeBridge.tgLimiter)
}

export function startBridge(): Bot | null {
	const token = Deno.env.get('TELEGRAM_BOT_TOKEN')
	const groups = groupIds()

	if (!token || !groups.personal) {
		console.log(
			'[BRIDGE] disabled: set TELEGRAM_BOT_TOKEN and TELEGRAM_SUPERGROUP_PERSONAL (or legacy TELEGRAM_SUPERGROUP_ID) to enable',
		)
		return null
	}
	if (!isDual(groups)) {
		console.log(
			'[BRIDGE] single-group mode: set TELEGRAM_SUPERGROUP_BUSINESS to split personal/business.',
		)
	}

	const db = new BridgeDB('conf/gen/bridge.db')
	db.init(groups.legacy || groups.personal)
	// Telegram and WhatsApp have independent budgets, so they get independent
	// queues. All forum topics share ONE supergroup, whose flood control is
	// stricter than 1 msg/s (~20/min per group + burst penalties with
	// retry_after up to tens of seconds), hence the conservative 3s default.
	// TELEGRAM_RATE_LIMIT_MS overrides the legacy RATE_LIMIT_MS name.
	const tgLimiter = new RateLimiter(
		envNum('TELEGRAM_RATE_LIMIT_MS', envNum('RATE_LIMIT_MS', 3000)),
		{
			maxRetries: envNum('RATE_LIMIT_MAX_RETRIES', 5),
			maxWaitMs: envNum('RATE_LIMIT_MAX_WAIT_MS', 120_000),
		},
	)
	// WhatsApp sends don't consume Telegram budget - light spacing only, so a
	// Telegram flood never stalls the TG→WA direction (and vice versa).
	const waLimiter = new RateLimiter(envNum('WHATSAPP_RATE_LIMIT_MS', 500))

	const tg = new Bot(token)
	registerTgHandlers(tg, db, tgLimiter, waLimiter)
	// The WA socket is already connected by wa.ts at this point.
	attachWaRelay(tg, db, tgLimiter)
	activeBridge = { tg, db, tgLimiter, waLimiter }
	// Owner identity for @all/@mention pings - resolves in the background
	// so boot never blocks on it; mentions stay plain text until it lands.
	void resolveOwnerIdentity(tg, groups.personal)

	tg.catch((e) => console.error('[BRIDGE] Telegram handler error:', e))
	// Fire-and-forget: bot.start() long-polls until stopped; never await it
	// here or wa.ts would never finish booting.
	//
	// allowed_updates MUST list message_reaction explicitly: Telegram excludes
	// it (with chat_member and message_reaction_count) from the default set,
	// so without this the TG→WA reaction handler never fires - silently.
	// The bot must also be an administrator in the supergroup, otherwise
	// Telegram withholds these updates too (checked below, non-fatal warn).
	tg.start({
		allowed_updates: [
			'message',
			'edited_message',
			'message_reaction',
			'callback_query',
			'poll_answer',
		],
	}).catch((e) => console.error('[BRIDGE] Telegram polling stopped:', e))
	for (const gid of [...new Set([groups.personal, groups.business])]) {
		void checkReactionPrereqs(tg, gid)
	}

	console.log('[BRIDGE] running: WhatsApp <-> Telegram topic mirror active')
	return tg
}

// Parse a numeric env var with a safe fallback (unset, empty, NaN and
// negatives all fall back - a 0/negative spacing would defeat the queue).
function envNum(name: string, fallback: number): number {
	const raw = Deno.env.get(name)
	if (raw == null || raw.trim() === '') return fallback
	const n = Number(raw)
	return Number.isFinite(n) && n >= 0 ? n : fallback
}

// Resolve the owner's Telegram identity for @all/@mention notifications.
// Explicit TELEGRAM_OWNER_ID wins; otherwise the personal supergroup creator
// (the account that created the mirror supergroup). Stored on relayCtx;
// failures just leave owner mentions as plain text.
async function resolveOwnerIdentity(tg: Bot, supergroupId: string): Promise<void> {
	try {
		const envId = Number(Deno.env.get('TELEGRAM_OWNER_ID') || '')
		if (Number.isFinite(envId) && envId > 0) {
			relayCtx.ownerTg = { id: envId, is_bot: false, first_name: 'you' }
			return
		}
		if (!supergroupId) return
		const admins = await tg.api.getChatAdministrators(supergroupId).catch(() => null)
		const creator = (admins || []).find((a: any) => a?.status === 'creator') as any
		const u = creator?.user
		if (u && typeof u.id === 'number') {
			relayCtx.ownerTg = {
				id: u.id,
				is_bot: false,
				first_name: String(u.first_name || 'you'),
			}
		}
	} catch {
		// Owner identity unknown - owner mentions just stay plain text.
	}
}

// Non-blocking sanity check: reacting on Telegram only reaches the bridge
// when the bot is an admin of the supergroup, and WA pin sync needs pin
// rights on top. Warns instead of failing the boot - messaging works fine
// without either, reactions and pins just stay silent.
async function checkReactionPrereqs(tg: Bot, supergroupId: string): Promise<void> {
	try {
		const me = await tg.api.getMe()
		const member = await tg.api.getChatMember(supergroupId, me.id).catch(() => null) as
			| { status?: string; can_pin_messages?: boolean }
			| null
		if (!member) return
		if (member.status !== 'administrator' && member.status !== 'creator') {
			console.warn(
				`[BRIDGE] Telegram reactions need the bot to be an administrator of the supergroup (currently: ${member.status}). ` +
					'TG→WA reactions will not arrive until it is promoted.',
			)
			return
		}
		if (member.status === 'administrator' && member.can_pin_messages === false) {
			console.warn(
				'[BRIDGE] WA pin sync needs the bot to pin messages in the supergroup (currently disallowed). ' +
					'WA pins will fail until pin rights are granted.',
			)
		}
	} catch {
		// Prereq check failed (network, permissions) - reactions just stay silent.
	}
}

if (import.meta.main) {
	if (Deno.args.includes('--find-id')) {
		await findSupergroupId()
	} else {
		console.error('This module runs embedded in the WhatsApp bot (see wa.ts).')
		console.error('Helper: deno run -A --env-file=conf/.env bridge/mod.ts -- --find-id')
		Deno.exit(1)
	}
}
