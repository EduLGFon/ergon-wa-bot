import { folderHandler, loadCmd, loadEvent } from 'util/client.ts'
import proto, { run } from 'util/proto.ts'
import { Client, LocalAuth } from 'wa'

proto() // load prototypes
await run('pkill chrome') // puppeeter does not close when using --watch
const bot = new Client({
	authStrategy: new LocalAuth({ dataPath: 'conf', clientId: 'ergon' }),
	// auth path = conf/session-ergon
	puppeteer: { args: ['--no-sandbox', '--disable-setuid-sandbox'] },
})

const cwd = Deno.cwd() // current working directory
folderHandler(cwd + '/event', loadEvent, bot) // load all events
folderHandler(cwd + '/cmd', loadCmd, bot) // load all commands

bot.initialize()

// Crash handler
addEventListener('unhandledrejection', (e) => console.log('Unhandled rejection:', e.reason, 'red'))
addEventListener('uncaughtException', (e) => console.log('Uncaught exception:', e, 'red'))
addEventListener(
	'uncaughtExceptionMonitor',
	(e) => console.log('Uncaught exception monitor:', e, 'red'),
)
