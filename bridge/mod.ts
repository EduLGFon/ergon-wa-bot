import { Bot } from 'grammy'
import { BridgeDB } from './db.ts'
import { RateLimiter } from './rate-limiter.ts'
import { startTelegramBot } from './tg-to-wa.ts'
import { start, stop as stopWaRelay } from './wa-to-tg.ts'

async function findSupergroupId(): Promise<void> {
	const token = Deno.env.get('TELEGRAM_BOT_TOKEN')
	if (!token) {
		console.error('Missing TELEGRAM_BOT_TOKEN in .env')
		Deno.exit(1)
	}

	const bot = new Bot(token)
	const updates = await bot.api.getUpdates({ limit: 100 })

	for (const update of updates as any[]) {
		const chat = update.message?.chat || update.edited_message?.chat ||
			update.channel_post?.chat
		if (chat && (chat.type === 'supergroup' || chat.type === 'group')) {
			console.log(`\n📍 Supergroup ID: \`${chat.id}\`\n`)
			console.log(`Copy this ID and set it as TELEGRAM_SUPERGROUP_ID in your .env file.`)
			console.log(`Chat title: ${chat.title || 'N/A'}`)
			console.log(`Is forum: ${chat.is_forum || false}`)
			Deno.exit(0)
		}
	}

	console.log('No supergroup found in recent updates.')
	console.log('Make sure the bot is added to the supergroup and send a message there first.')
	console.log('\nTo add the bot:')
	console.log('  1. Add bot to supergroup as admin')
	console.log('  2. Send a message in the supergroup')
	console.log('  3. Run this command again')
}

async function main() {
	const args = Deno.args

	if (args.includes('--find-id')) {
		await findSupergroupId()
		return
	}

	const TELEGRAM_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')
	const SUPERGROUP_ID = Deno.env.get('TELEGRAM_SUPERGROUP_ID')

	if (!TELEGRAM_TOKEN || !SUPERGROUP_ID) {
		console.error('Missing TELEGRAM_BOT_TOKEN or TELEGRAM_SUPERGROUP_ID in .env')
		console.error('\nRun with --find-id to discover the supergroup ID:')
		console.error('  deno run -A --env-file=.env mod.ts -- --find-id')
		Deno.exit(1)
	}

	console.log('[BRIDGE] Starting...')
	console.log('[BRIDGE] DB path: conf/gen/bridge.db')
	console.log('[BRIDGE] Auth path: ../conf/gen/auth')
	console.log('[BRIDGE] Telegram token:', TELEGRAM_TOKEN ? 'set' : 'MISSING')
	console.log('[BRIDGE] Supergroup ID:', SUPERGROUP_ID || 'MISSING')

	const db = new BridgeDB('../conf/gen/bridge.db')
	db.init()

	const rateLimiter = new RateLimiter(Number(Deno.env.get('RATE_LIMIT_MS') || 1000))

	console.log('[BRIDGE] Starting Telegram bot...')
	const tgBot = startTelegramBot(db, rateLimiter)
	await tgBot.start()

	console.log('[BRIDGE] Starting WhatsApp relay...')
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
	Deno.exit(0)
})
Deno.addSignalListener('SIGTERM', async () => {
	await stopWaRelay()
	Deno.exit(0)
})
