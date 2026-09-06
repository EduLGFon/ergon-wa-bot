import { BridgeDB } from './db.ts'
import { RateLimiter } from './rate-limiter.ts'
import { startTelegramBot } from './tg-to-wa.ts'
import { start, stop as stopWaRelay } from './wa-to-tg.ts'

async function main() {
	const TELEGRAM_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')
	const SUPERGROUP_ID = Deno.env.get('TELEGRAM_SUPERGROUP_ID')

	if (!TELEGRAM_TOKEN || !SUPERGROUP_ID) {
		console.error('Missing TELEGRAM_BOT_TOKEN or TELEGRAM_SUPERGROUP_ID in .env')
		Deno.exit(1)
	}

	const db = new BridgeDB('conf/gen/bridge.db')
	db.init()

	const rateLimiter = new RateLimiter(Number(Deno.env.get('RATE_LIMIT_MS') || 1000))

	const tgBot = startTelegramBot(db, rateLimiter)
	await tgBot.start()

	await start(db, rateLimiter, tgBot)

	console.log('[BRIDGE] WhatsApp ↔ Telegram bridge is running')
	console.log('[BRIDGE] Press Ctrl+C to stop')
}

main().catch((e) => {
	console.error('[BRIDGE] Fatal error:', e)
	Deno.exit(1)
})

Deno.addSignalListener('SIGINT', async () => {
	await stopWaRelay()
	// The tgBot.stop() will be called by the process exit
	Deno.exit(0)
})
Deno.addSignalListener('SIGTERM', async () => {
	await stopWaRelay()
	Deno.exit(0)
})
