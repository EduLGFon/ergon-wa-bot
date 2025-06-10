import { Baileys, locale, proto, reminder } from './map.js'

const logger = proto() // load prototypes
locale() // load locales
const bot = new Baileys('conf/auth', logger)
// auth/ contains auth info to login without scan QR Code again

start()
async function start() {
	await bot.connect()
	reminder(bot) // start reminder service
}

process // "anti-crash" to handle lib instabilities
	.on('SIGINT', async (_e) => await bot.cache.save()) // save cache before exit
	.on('uncaughtException', (e) => console.error(e, `Uncaught Excep.:`))
	.on('unhandledRejection', (e: Error) => console.error(e, `Unhandled Rej:`))
	.on('uncaughtExceptionMonitor', (e) => console.error(e, `Uncaught Excep.M.:`))
