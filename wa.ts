import { scheduleURMenuMsg } from '@plugin/menuScraping.ts'
import { loadCmds, loadEvents } from '@util/handler.ts'
import cache from '@plugin/cache.ts'
import locale from '@util/locale.ts'
import proto from '@util/proto.ts'
import bot from '@plugin/bot.ts'

proto() // load prototypes
locale() // load locales

start()
async function start() {
	await bot.connect()
	await loadCmds()
	await cache.resume()
	await loadEvents()

	// Telegram bridge shares this process's WhatsApp socket (no 2nd connection).
	// Must start AFTER loadEvents(), which resets event listeners.
	try {
		const { startBridge } = await import('./bridge/mod.ts')
		await startBridge()
	} catch (e) {
		print('BRIDGE', `disabled: ${(e as Error)?.message || e}`, 'red')
	}

	if (Deno.env.get('GROUPS1')) scheduleURMenuMsg()
}

// Save cache on both SIGINT (Ctrl+C) and SIGTERM (PM2 stop/restart)
const onExit = async () => {
	await cache.save()
	Deno.exit(0)
}
Deno.addSignalListener('SIGINT', onExit)
Deno.addSignalListener('SIGTERM', onExit)
