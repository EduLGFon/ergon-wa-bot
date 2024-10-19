import { Cmd, Collection, emojis, getCtx, Group, Logger, Msg, msgMeta, User } from '../map.js'
import baileys, {
	type AnyMessageContent,
	type BaileysEventMap,
	Browsers,
	downloadMediaMessage,
	fetchLatestBaileysVersion,
	makeCacheableSignalKeyStore,
	makeInMemoryStore,
	makeWASocket,
	useMultiFileAuthState,
	WAMessageKey,
	type WASocket,
} from 'baileys'
import pino from 'pino'
import { resolve } from 'node:path'
import { readdirSync } from 'node:fs'

const logger: Logger = pino.default()
logger.level = 'silent'

export default class Baileys {
	sock!: WASocket

	// Collections (Stored data)
	cmds: Collection<str, Cmd>
	// msgs: Collection<WAMessageKey, proto.IMessage>
	store: ReturnType<typeof makeInMemoryStore>
	wait: Collection<str, Func>
	alias: Collection<str, str>
	users: Collection<str, User>
	events: Collection<str, Func>
	groups: Collection<str, Group>

	constructor(public auth: str) {
		this.auth = auth // auth folder

		/** msgs: (bot sent msgs on store)
		 * why only bot msgs? Sometimes Baileys fails
		 * sending a msg, and if it has no msg store,
		 * the msg will never be sent. Other users will
		 * see "Waiting for this message" for eternity.
		 * So, this Collection stores the msg until
		 * it is sent again
		 */
		// this.msgs = new Collection(10) it's commented bc i'm using baileys store rn
		this.store = makeInMemoryStore({ logger })
		// wait: arbitrary functions that can be called on events
		this.wait = new Collection(0)
		// Cmd aliases map
		this.alias = new Collection(0)
		// Events collection (0 means no limit)
		this.events = new Collection(0)
		// Cmds collection
		this.cmds = new Collection(0, Cmd)
		// Users collection
		this.users = new Collection(100, User)
		// Groups collection
		this.groups = new Collection(500, Group)
	}

	async connect() {
		// Fetch latest WA version
		// const { version } = await fetchLatestBaileysVersion()
		/** WA is showing fake versions to ban bots. DO NOT UNCOMMENT IT */

		const version: [num, num, num] = [2, 3000, 1015901307]
		// This version is secure
		print('NET', `Connecting to WA v${version.join('.')}`, 'green')

		// Use saved session
		const { state, saveCreds } = await useMultiFileAuthState(this.auth)

		this.sock = makeWASocket({
			auth: {
				creds: state.creds,
				// cache makes the store send/receive msgs faster
				keys: makeCacheableSignalKeyStore(state.keys, logger),
			},
			logger,
			version,
			syncFullHistory: false,
			printQRInTerminal: true,
			markOnlineOnConnect: false,
			browser: Browsers.macOS('Desktop'),
			// ignore status updates
			shouldIgnoreJid: (jid: str) => jid?.includes('broadcast'),
			getMessage: this.getMsg, // get stored msgs to resent failed ones
		})
		this.store?.bind(this.sock.ev)

		// save login creds
		this.sock.ev.on('creds.update', saveCreds)

		// Load commands
		await this.folderHandler(`./build/cmd`, this.loadCmds)
		// folderHandler() will read a folder and call callback
		// for each file

		// Load events
		await this.folderHandler(`./build/event`, this.loadEvents)
		return
	}

	// Send: Intermediate function to send msgs easier
	async send(
		id: str | Msg,
		body: str | AnyMessageContent,
		reply?: baileys.proto.IWebMessageInfo,
	) {
		let { text, chat, quote } = msgMeta(id, body, reply)
		// get msg metadata

		const msg = await this.sock.sendMessage(chat, text, quote)

		// convert raw msg on cmd context
		return await getCtx(msg!, this)
	}

	// React: react on a msg
	async react(m: Msg, emoji: str) {
		const { chat, key } = m

		// @ts-ignore find emojis by name | 'ok' => '✅'
		const reaction = emojis[emoji] || emoji
		return await this.send(chat, { react: { text: reaction, key } })
	}

	async editMsg(msg: Msg, text: str) {
		const { chat, key } = msg

		return await this.sock.sendMessage(chat, { edit: key, text })
	}

	async deleteMsg(msgOrKey: Msg | baileys.proto.IMessageKey) {
		const { chat, key } = msgMeta(msgOrKey, '')
		// get msg metadata

		return await this.send(chat, { delete: key })
	}

	// get a group cache or fetch it
	async getGroup(id: str): Promise<Group> {
		let group = this.groups.get(id) // cache

		if (group) return group
		else {
			// fetch group metadata
			group = await this.sock.groupMetadata(id)

			group = await this.groups.add(group.id, group)
			return group
		}
	}

	// getMsgs: get bot sent msgs to prevent msg failure
	async getMsg(key: WAMessageKey): Promise<baileys.proto.IMessage | undefined> {
		if (this.store) {
			const msg = await this.store.loadMessage(key.remoteJid!, key.id!)
			return msg?.message || undefined
		}

		// only if store is present
		return baileys.proto.Message.fromObject({})
	}

	async downloadMedia(msg: Msg) {
		const media = await downloadMediaMessage(msg.raw, 'buffer', {}, {
			logger,
			reuploadRequest: this.sock.updateMediaMessage,
		})! as Buf

		return media || await this.sock.updateMediaMessage(msg.raw)
	}

	async folderHandler(path: str, handler: Func) {
		path = resolve(path)
		let count = 0

		for (const category of readdirSync(path)) {
			// For each category folder
			for (const file of readdirSync(`${path}/${category}`)) {
				// for each file of each category
				const imported = await import(`file://${path}/${category}/${file}`)

				// call callback function to this file
				handler.bind(this)(file, category, imported.default)
				count++
			}
		}

		print(
			'HANDLER',
			`${count} ${path.includes('event') ? 'events' : 'cmds'} loaded`,
			'yellow',
		)
		return
	}

	async loadCmds(file: str, _category: str, imported: any) { // DENO point
		const cmd: Cmd = new imported()
		cmd.name = file.slice(0, -3) // remove .ts

		this.cmds.set(cmd.name!, cmd)
		// Set cmd

		cmd.alias.forEach((a) => this.alias.set(a, cmd.name!))
		// Set cmd aliases
	}

	async loadEvents(file: str, category: str, imported: any) {
		const event = imported
		const name = `${category}.${file.slice(0, -3)}`
		// folder+file names are the same of lib events
		this.events.set(name, event)

		// Listen to the event here
		this.sock.ev.on(name as keyof BaileysEventMap, (...args) => {
			// It allows to modify events in run time
			this.events.get(name)!(this, ...args, name)
				.catch((e: Error) => console.error(e, `EVENT/${name}:`))
			// eventFunction(this, ...args, name);
		})
	}
}
