import { scheduleURMenuMsg } from './util/menuScrapping.ts'
import { loadCmds, loadEvents } from './util/handler.ts'
import { locale, proto } from './map.ts'
// import cache from './plugin/cache.ts'
import Baileys from './class/baileys.ts'

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
// .on('uncaughtException', e => print(`Uncaught Excep.:`, e, 'red'))
// .on('unhandledRejection', (e: Error) => print(`Unhandled Rej:`, e, 'red'))
// .on('uncaughtExceptionMonitor', e => print(`Uncaught Excep.M.:`, e, 'red'))
