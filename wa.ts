import { scheduleURMenuMsg } from './plugin/menuScraping.ts'
import { loadCmds, loadEvents } from './util/handler.ts'
import cache, { cleanTemp } from './plugin/cache.ts'
import { locale, proto } from './map.ts'
import Baileys from './class/baileys.ts'

proto() // load prototypes
locale() // load locales
const bot = new Baileys()

start()
async function start() {
	await bot.connect()
	await loadCmds()
	await cache.resume()
	await cleanTemp()
	await loadEvents()

	if (process.env.GROUPS1) scheduleURMenuMsg()
}

export default bot
// Save cache on both SIGINT (Ctrl+C) and SIGTERM (PM2 stop/restart)
const onExit = async () => {
	await cache.save()
	process.exit(0)
}
process.on('SIGINT', onExit)
process.on('SIGTERM', onExit)
