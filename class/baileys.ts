import {
	Browsers,
	makeCacheableSignalKeyStore,
	makeWASocket,
	useMultiFileAuthState,
	type WASocket,
} from 'baileys'
import { logger } from '../util/proto.js'

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
		console.log('Using auth state:', this.auth)

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
}
