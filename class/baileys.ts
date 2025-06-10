import { CacheManager, Cmd, emojis, getCtx, Group, Logger, Msg, msgMeta, User } from '../map.js'
import baileys, {
	type AnyMessageContent,
	type BaileysEventMap,
	Browsers,
	downloadMediaMessage,
	// fetchLatestBaileysVersion,
	makeCacheableSignalKeyStore,
	makeWASocket,
	useMultiFileAuthState,
	type WASocket,
} from 'baileys'
import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'

export default class Baileys {
	sock!: WASocket

	// Cache (Stored data)
	cache: CacheManager

	constructor(public auth: str, public logger: Logger) {
		this.auth = auth // auth folder
		this.logger = logger

		this.cache = new CacheManager(this)
	}

	async connect() {
		// Fetch latest WA version
		// const { version } = await fetchLatestBaileysVersion()
		/** WA is showing fake versions to ban bots. DO NOT UNCOMMENT IT */

		const version: [num, num, num] = [2, 3000, 1023223821]
		// This version is secure
		print('NET', `Connecting to WA v${version.join('.')}`, 'green')

		// Use saved session
		const { state, saveCreds } = await useMultiFileAuthState(this.auth)

		this.sock = makeWASocket({
			auth: {
				creds: state.creds,
				// cache makes the store send/receive msgs faster
				keys: makeCacheableSignalKeyStore(state.keys, this.logger),
			},
			logger: this.logger,
			version,
			syncFullHistory: false,
			markOnlineOnConnect: false,
			browser: Browsers.macOS('Desktop'),
			// ignore status updates
			shouldIgnoreJid: (jid: str) =>
				jid?.includes('broadcast') || jid?.includes('newsletter') ||
				jid?.includes('13135550002@s.whatsapp.net'),
		})

		// save login creds
		this.sock.ev.on('creds.update', saveCreds)

		// Load commands
		await this.folderHandler(`./build/cmd`, this.loadCmds)
		// folderHandler() will read a folder and call callback
		// for each file

		// Load events
		await this.folderHandler(`./build/event`, this.loadEvents)

		this.cache.start()
		return
	}

	// Send: Intermediate function to send msgs easier
	async send(
		id: str | Msg,
		body: str | AnyMessageContent,
		reply?: baileys.proto.IWebMessageInfo,
	) {
		let { text, chat, quote: _q } = msgMeta(id, body, reply)
		// get msg metadata

		const msg = await this.sock.sendMessage(chat, text) //, quote)

		// convert raw msg on cmd context
		return await getCtx(msg!, this)
	}

	// React: react on a msg
	async react(m: Msg, emoji: str) {
		const { chat, key } = m

		// @ts-ignore find emojis by name | 'ok' => '✅'
		const text = emojis[emoji] || emoji
		await this.send(chat, { react: { text, key } })
		return
	}

	async editMsg(msg: Msg, text: str) {
		const { chat, key } = msg

		return await this.send(chat, { edit: key, text })
	}

	async deleteMsg(msgOrKey: Msg | baileys.proto.IMessageKey) {
		const { chat, key } = msgMeta(msgOrKey, '')
		// get msg metadata

		return await this.send(chat, { delete: key })
	}

	async getUser({ id, phone }: { id?: num; phone?: str }): Promise<User | undefined> {
		let user

		if (id) { // means user is already on db
			const cache = this.cache.users.get(id)

			if (cache) return cache
			user = await new User({ id }).checkData()
			this.cache.users.add(id, user)
		} else {
			const number = phone!.parsePhone()
			const cache = this.cache.users.find((u) => u.phone === number)

			if (cache) return cache
			user = await new User({ phone }).checkData()
			if (!user) return
			if (!process.env.DATABASE_URL) user.id = Number(user.phone)
			this.cache.users.add(user.id, user)
		}

		return user
	}

	// get a group cache or fetch it
	async getGroup(id: str): Promise<Group> {
		let group = this.cache.groups.get(id) // cache

		if (group) return group
		else {
			// fetch group metadata
			group = await this.sock.groupMetadata(id)

			group = await new Group(group).checkData(this)
			this.cache.groups.add(group.id, group)
			return group
		}
	}

	async downloadMedia(msg: Msg) {
		const media = await downloadMediaMessage(msg, 'buffer', {}, {
			logger: this.logger,
			reuploadRequest: this.sock.updateMediaMessage,
		})! as Buf

		return media || await this.sock.updateMediaMessage(msg)
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

		this.cache.cmds.add(cmd.name!, cmd)
		// Set cmd
	}

	async loadEvents(file: str, category: str, imported: any) {
		const event = imported
		const name = `${category}.${file.slice(0, -3)}`
		// folder+file names are the same of lib events
		this.cache.events.set(name, event)

		// Listen to the event here
		this.sock.ev.on(name as keyof BaileysEventMap, (...args) => {
			// It allows to modify events in run time
			this.cache.events.get(name)!(this, ...args, name)
				.catch((e: Error) => console.error(e, `EVENT/${name}:`))
			// eventFunction(this, ...args, name);
		})
	}
}
