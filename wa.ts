import { loadCmds, loadEvents } from './util/handler.js'
import { locale, proto } from './map.js'
// import cache from './plugin/cache.js'
import Baileys from './class/baileys.js'
import { scheduleURMenuMsg } from './util/menuScrapping.js'

proto() // load prototypes
locale() // load locales
const bot = new Baileys()

start()
async function start() {
	await bot.connect()
	await loadCmds()
	await loadEvents()

	if (process.env.GROUPS1) scheduleURMenuMsg()
}

export default bot
process // "anti-crash" to handle lib instabilities
	// .on('SIGINT', async (_e) => await cache.save()) // save cache before exit
	.on('uncaughtException', e => print(`Uncaught Excep.:`, e, 'red'))
	.on('unhandledRejection', (e: Error) => print(`Unhandled Rej:`, e, 'red'))
	.on('uncaughtExceptionMonitor', e => print(`Uncaught Excep.M.:`, e, 'red'))
