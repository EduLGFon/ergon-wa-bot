import { Cmd, Group, User } from '../map.js'
import {
	type BaileysEventMap,
	Browsers,
	makeCacheableSignalKeyStore,
	makeWASocket,
	useMultiFileAuthState,
	type WASocket,
} from 'baileys'
import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { logger } from '../util/proto.js'
import cache from '../plugin/cache.js'

export default class Baileys {
	sock!: WASocket

	// Cache (Stored data)

	constructor(public auth: str) {
		this.auth = auth // auth folder
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
				keys: makeCacheableSignalKeyStore(state.keys, logger),
			},
			logger,
			version,
			markOnlineOnConnect: false,
			browser: Browsers.macOS('Desktop'),
			syncFullHistory: false,
			shouldSyncHistoryMessage: () => false,
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
		return
	}

	async getUser({ id, phone }: { id?: num; phone?: str }): Promise<User | undefined> {
		let user

		if (id) { // means user is already on db
			const data = cache.users.get(id)

			if (data) return data
			user = await new User({ id }).checkData()
			cache.users.add(id, user)
		} else {
			const number = phone!.parsePhone()
			const data = cache.users.find((u) => u.phone === number)

			if (data) return data
			user = await new User({ phone }).checkData()
			if (!user) return
			if (!process.env.DATABASE_URL) user.id = Number(user.phone)
			cache.users.add(user.id, user)
		}

		return user
	}

	// get a group cache or fetch it
	async getGroup(id: str): Promise<Group> {
		let group = cache.groups.get(id) // cache

		if (group) return group
		else {
			// fetch group metadata
			const data = await this.sock.groupMetadata(id)

			group = await new Group(data).checkData(this)
			cache.groups.set(group.id, group)
			return group
		}
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

		cache.cmds.add(cmd.name!, cmd)
		// Set cmd
	}

	async loadEvents(file: str, category: str, imported: any) {
		const event = imported
		const name = `${category}.${file.slice(0, -3)}`
		// folder+file names are the same of lib events
		cache.events.set(name, event)

		// Listen to the event here
		this.sock.ev.on(name as keyof BaileysEventMap, (...args) => {
			// It allows to modify events in run time
			cache.events.get(name)!(this, ...args, name)
				.catch((e: Error) => console.error(e, `EVENT/${name}:`))
			// eventFunction(this, ...args, name);
		})
	}
}
