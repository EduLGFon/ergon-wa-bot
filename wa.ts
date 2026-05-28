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
process
	.on('SIGINT', async (_e) => await cache.save()) // save cache before exit
// .on('uncaughtException', e => print(`Uncaught Excep.:`, e, e.stack, 'red'))
// .on('unhandledRejection', (e: Error) => print(`Unhandled Rej:`, e, e.stack, 'red'))
// .on('uncaughtExceptionMonitor', e => print(`Uncaught Excep.M.:`, e, e.stack, 'red'))
