import {
	Browsers,
	isJidBot,
	isJidBroadcast,
	isJidMetaIa,
	isJidNewsletter,
	isJidStatusBroadcast,
	makeCacheableSignalKeyStore,
	makeWASocket,
	useMultiFileAuthState,
	type WASocket,
} from 'baileys'
import postgresAuthState from '../plugin/authState.js'
import { logger } from '../util/proto.js'

export default class Baileys {
	sock!: WASocket

	constructor() {}

	async connect() {
		// Use saved session
		const { state, saveCreds } = process.env.DATABASE_URL
			? await postgresAuthState('ergon')
			: await useMultiFileAuthState('conf/auth')

		this.sock = makeWASocket({
			auth: {
				creds: state.creds,
				// cache makes the store send/receive msgs faster
				keys: makeCacheableSignalKeyStore(state.keys, logger),
			},
			logger,
			markOnlineOnConnect: false,
			browser: Browsers.macOS('Desktop'),
			syncFullHistory: false,
			shouldSyncHistoryMessage: () => false,
			// ignore useless msgs
			shouldIgnoreJid: (jid: str) =>
				isJidBot(jid) ||
				isJidBroadcast(jid) || isJidNewsletter(jid) ||
				isJidMetaIa(jid) || isJidStatusBroadcast(jid),
		})

		// save login creds
		this.sock.ev.on('creds.update', saveCreds)
		return
	}
}
