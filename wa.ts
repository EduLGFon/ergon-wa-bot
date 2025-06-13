import { Baileys, locale, proto, reminder } from './map.js'
// import cache from './plugin/cache.js'
import { loadCmds, loadEvents } from './util/handler.js'

proto() // load prototypes
locale() // load locales
const bot = new Baileys('conf/auth')
// auth/ contains auth info to login without scan QR Code again

start()
async function start() {
	await bot.connect()
	await loadCmds()
	await loadEvents()
	reminder(bot) // start reminder service
}

export default bot
process // "anti-crash" to handle lib instabilities
	// .on('SIGINT', async (_e) => await cache.save()) // save cache before exit
	.on('uncaughtException', (e) => console.error(e, `Uncaught Excep.:`))
	.on('unhandledRejection', (e: Error) => console.error(e, `Unhandled Rej:`))
	.on('uncaughtExceptionMonitor', (e) => console.error(e, `Uncaught Excep.M.:`))
