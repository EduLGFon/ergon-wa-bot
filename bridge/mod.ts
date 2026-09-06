// Bridge entry point.
//
// Two ways to use it:
//
// 1. Embedded (normal): wa.ts calls `startBridge()` AFTER bot.connect() +
//    loadEvents(). The bridge shares the running WhatsApp socket — no second
//    connection, no auth duplication.
// 2. Standalone helper: `deno run -A bridge/mod.ts -- --find-id` prints the
//    supergroup ID so you can put it in conf/.env. This mode never touches
//    WhatsApp.
import { Bot } from 'grammy'
import { BridgeDB } from './db.ts'
import { RateLimiter } from './rate-limiter.ts'
import { registerTgHandlers } from './tg-to-wa.ts'
import { attachWaRelay } from './wa-to-tg.ts'

export async function findSupergroupId(): Promise<void> {
	const token = Deno.env.get('TELEGRAM_BOT_TOKEN')
	if (!token) {
		console.error('Missing TELEGRAM_BOT_TOKEN in env')
		Deno.exit(1)
	}

	const bot = new Bot(token)
	const updates = await bot.api.getUpdates({ limit: 100 })

	for (const update of updates as any[]) {
		const chat = update.message?.chat || update.edited_message?.chat ||
			update.channel_post?.chat
		if (chat && (chat.type === 'supergroup' || chat.type === 'group')) {
			console.log(`\nSupergroup ID: \`${chat.id}\`\n`)
			console.log(`Copy this ID and set it as TELEGRAM_SUPERGROUP_ID in conf/.env.`)
			console.log(`Chat title: ${chat.title || 'N/A'}`)
			console.log(`Is forum: ${chat.is_forum || false}`)
			Deno.exit(0)
		}
	}

	console.log('No supergroup found in recent updates.')
	console.log('Make sure the bot is added to the supergroup and send a message there first.')
}

// Starts the Telegram side and hooks the WA→TG relay onto the shared socket.
// Returns null (instead of throwing) when not configured, so the WhatsApp
// bot always boots even if the bridge env is missing.
export function startBridge(): Bot | null {
	const token = Deno.env.get('TELEGRAM_BOT_TOKEN')
	const supergroupId = Deno.env.get('TELEGRAM_SUPERGROUP_ID')

	if (!token || !supergroupId) {
		console.log(
			'[BRIDGE] disabled: set TELEGRAM_BOT_TOKEN and TELEGRAM_SUPERGROUP_ID to enable',
		)
		return null
	}

	const db = new BridgeDB('conf/gen/bridge.db')
	db.init()
	const limiter = new RateLimiter(Number(Deno.env.get('RATE_LIMIT_MS') || 1000))

	const tg = new Bot(token)
	registerTgHandlers(tg, db, limiter)
	// The WA socket is already connected by wa.ts at this point.
	attachWaRelay(tg, db, limiter)

	tg.catch((e) => console.error('[BRIDGE] Telegram handler error:', e))
	// Fire-and-forget: bot.start() long-polls until stopped; never await it
	// here or wa.ts would never finish booting.
	tg.start().catch((e) => console.error('[BRIDGE] Telegram polling stopped:', e))

	console.log('[BRIDGE] running: WhatsApp <-> Telegram topic mirror active')
	return tg
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
