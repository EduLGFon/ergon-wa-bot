import { Cmd, Collection, emojis, getCtx, Group, Logger, Msg, msgMeta, User } from '../map.js'
import {
	type AnyMessageContent,
	type BaileysEventMap,
	Browsers,
	downloadMediaMessage,
	fetchLatestBaileysVersion,
	makeCacheableSignalKeyStore,
	makeWASocket,
	type proto,
	useMultiFileAuthState,
	type WASocket,
} from 'baileys'
import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import pino from 'pino'

const logger: Logger = pino.default()
logger.level = 'silent'

export default class Baileys {
	sock!: WASocket

	// Collections (Stored data)
	cmds: Collection<string, Cmd>
	users: Collection<string, User>
	groups: Collection<string, Group>
	wait: Collection<string, Function>
	alias: Collection<string, string>
	events: Collection<string, Function>

	constructor(public auth: str) {
		this.auth = auth // auth folder

		// wait: arbitrary functions that can be called on events
		this.wait = new Collection(0)
		// Users collection
		this.users = new Collection(100, User)
		// Groups collection
		this.groups = new Collection(500, Group)
		// Events collection (0 means no limit)
		this.events = new Collection(0)
		// Cmds collection
		this.cmds = new Collection(0, Cmd)
		// Cmd aliases map
		this.alias = new Collection(0)
	}

	async connect() {
		// Fetch latest WA version
		const { version } = await fetchLatestBaileysVersion()
		print('WEBSOCKET', `Connecting to WA v${version.join('.')}`, 'green')

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
		})

		// save login creds
		this.sock.ev.on('creds.update', saveCreds)

		// Load commands
		this.folderHandler(`./build/cmd`, this.loadCmds)
		// folderHandler() will read a folder and call callback
		// for each file

		// Load events
		this.folderHandler(`./build/event`, this.loadEvents)
		return
	}

	// Send: Intermediate function to send msgs easier
	async send(id: str | Msg, body: str | AnyMessageContent, reply?: proto.IWebMessageInfo) {
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

	async deleteMsg(msgOrKey: Msg | proto.IMessageKey) {
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
			const groupData = new Group(group) // Group class includes useful properties

			this.groups.add(groupData.id, await groupData.checkData())
			// check group data on db
			return groupData
		}
	}

	async downloadMedia(msg: Msg) {
		const media = await downloadMediaMessage(msg.raw, 'buffer', {}, {
			logger,
			reuploadRequest: this.sock.updateMediaMessage,
		})! as Buffer

		return media || await this.sock.updateMediaMessage(msg.raw)
	}

	async folderHandler(path: str, handler: Function) {
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
			'magentaBright',
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
				.catch((e: any) => console.error(`Events#${name}: ${e.stack}`))
			// eventFunction(this, ...args, name);
		})
	}
}
