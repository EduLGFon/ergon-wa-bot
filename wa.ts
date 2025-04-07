import { folderHandler, loadCmd, loadEvent } from './util/client.ts'
import { Client, LocalAuth } from 'wa'
import proto, { run } from 'util/proto.ts'

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
