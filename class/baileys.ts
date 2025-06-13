import { Group, User } from '../map.js'
import {
	Browsers,
	makeCacheableSignalKeyStore,
	makeWASocket,
	useMultiFileAuthState,
	type WASocket,
} from 'baileys'
import { logger } from '../util/proto.js'
import cache from '../plugin/cache.js'

export async function connect(auth: str) {
	// Use saved session
	const { state, saveCreds } = await useMultiFileAuthState(auth)

	const bot = makeWASocket({
		auth: {
			creds: state.creds,
			// cache makes the store send/receive msgs faster
			keys: makeCacheableSignalKeyStore(state.keys, logger),
		},
		logger,
		version: [2, 3000, 1023223821], // await fetchLatestBaileysVersion(),
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
	bot.ev.on('creds.update', saveCreds)
	return bot

}

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
}
