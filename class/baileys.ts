// Baileys socket wrapper.
// Holds the singleton WA connection used by bot.ts and picks file or postgres auth state.
// Centralizes connect, lid resolution, and jid filters.
// Stability hardening: WhatsApp rejects handshakes that look "off". Since mid-2026 it
// terminates the `WEB + Desktop (DARWIN/WIN32)` fingerprint with 428 "Connection
// Terminated" (upstream #2671/#2677), so we advertise a regular Chrome tuple
// (WEB_BROWSER subplatform). WA Web versions roll out fast too, so the WA version is
// resolved live at boot with a fallback chain instead of a hardcoded pin.
import {
	Browsers,
	fetchLatestBaileysVersion,
	fetchLatestWaWebVersion,
	isJidBot,
	isJidBroadcast,
	isJidMetaAI,
	isJidNewsletter,
	isJidStatusBroadcast,
	makeCacheableSignalKeyStore,
	makeWASocket,
	useMultiFileAuthState,
	type WASocket,
} from 'baileys'
import postgresAuthState from '@plugin/authState.ts'
import { logger } from '@util/proto.ts'

// Last-resort pin: only used when BOTH live version fetchers fail. Keep it reasonably
// current - a stale value eventually triggers WA 405 (client_too_old) rejections.
const FALLBACK_WA_VERSION: [number, number, number] = [2, 3000, 1044006379]

// Cached resolution: a transient fetch failure on reconnect reuses the last known-good
// version instead of a stale pin. Refreshed when older than VERSION_REFRESH_MS.
let cachedVersion: [number, number, number] | null = null
let cachedAt = 0
let cachedSource = 'unresolved'
const VERSION_REFRESH_MS = 6 * 60 * 60 * 1000

function isWaVersion(v: unknown): v is [number, number, number] {
	return Array.isArray(v) && v.length === 3 && v.every((n) => Number.isFinite(n))
}

async function resolveVersion(): Promise<[number, number, number]> {
	const now = Date.now()
	if (cachedVersion && now - cachedAt < VERSION_REFRESH_MS) return cachedVersion

	cachedVersion = null
	// 1. Baileys repo pin - authoritative, refreshed upstream (#2728 fixed its staleness).
	try {
		const { version } = await fetchLatestBaileysVersion()
		if (isWaVersion(version)) {
			cachedVersion = version
			cachedSource = 'baileys'
		}
	} catch {
		// fall through to the live source
	}
	// 2. Live client_revision from web.whatsapp.com/sw.js - what servers currently expect.
	if (!cachedVersion) {
		try {
			const { version } = await fetchLatestWaWebVersion()
			if (isWaVersion(version)) {
				cachedVersion = version
				cachedSource = 'wa web'
			}
		} catch {
			// fall through to the pinned last-resort
		}
	}
	if (!cachedVersion) {
		cachedVersion = FALLBACK_WA_VERSION
		cachedSource = 'pinned fallback'
	}
	cachedAt = Date.now()
	return cachedVersion
}

export default class Baileys {
	lid: str = ''
	sock!: WASocket
	// sock is the real Baileys connection
	constructor() {}

	async connect() {
		// Use saved session (otherwise you'll need to log in again every time)
		const { state, saveCreds } = Deno.env.get('DATABASE_URL')
			? await postgresAuthState('2') // save auth creds/keys on db
			// using postgresAuthState will avoid MANY problems you will
			// encounter using the file system auth storing
			: await useMultiFileAuthState('conf/gen/auth')
		// it is here just bc you may don't have a postgresql db setted.

		const version = await resolveVersion()
		print('SOCK', `WA version ${version.join('.')} (${cachedSource})`, 'gray')

		this.sock = makeWASocket({
			auth: {
				creds: state.creds,
				// cache makes the store send/receive msgs faster
				keys: makeCacheableSignalKeyStore(state.keys, logger),
			},
			logger,
			markOnlineOnConnect: false, // your account won't be "online" all the time
			// 'Desktop' tuples are terminated by WA with 428 since mid-2026; a Chrome
			// tuple advertises the WEB_BROWSER subplatform WA accepts.
			// WA_BROWSER overrides for A/B tests without a code change:
			// macos-chrome (default), ubuntu-chrome, windows-chrome, ubuntu-firefox.
			browser: pickBrowser(),
			version,
			syncFullHistory: false,
			shouldSyncHistoryMessage: () => false,
			// Stability tuning: generous timeouts avoid false timeouts on slow uplinks,
			// retry counters survive reconnects, and init queries stay ON (WA expects
			// them - disabling triggers 428 terminations ~45s after connect).
			connectTimeoutMs: 60_000,
			defaultQueryTimeoutMs: 60_000,
			keepAliveIntervalMs: 30_000,
			maxMsgRetryCount: 5,
			msgRetryCounterCache,
			// ignore useless msgs
			shouldIgnoreJid: (jid: str) =>
				isJidBot(jid) ||
				isJidBroadcast(jid) ||
				isJidNewsletter(jid) ||
				isJidMetaAI(jid) ||
				isJidStatusBroadcast(jid),
		})

		// save login creds
		this.sock.ev.on('creds.update', saveCreds)

		// set bot lid
		const rawLid = this.sock.user?.lid
		this.lid = rawLid ? rawLid.split(':')[0] + '@lid' : ''
	}
}

// WA_BROWSER env override for 428 A/B tests: lets prod compare Chrome
// tuples without a redeploy. Unknown values fall back to macOS Chrome.
function pickBrowser(): [string, string, string] {
	const raw = (Deno.env.get('WA_BROWSER') || '').trim().toLowerCase()
	try {
		if (raw === 'ubuntu-chrome') return Browsers.ubuntu('Chrome')
		if (raw === 'windows-chrome') return Browsers.windows('Chrome')
		if (raw === 'ubuntu-firefox') return Browsers.ubuntu('Firefox')
		if (raw && raw !== 'macos-chrome') {
			console.warn(`[SOCK] unknown WA_BROWSER=${raw}, using macos-chrome`)
		}
	} catch {
		// Browsers.* unavailable - fall through to default
	}
	return Browsers.macOS('Chrome')
}

// msgRetryCounterCache must live OUTSIDE the socket: keeping it here means message retry
// counters survive reconnects, so a message isn't retried again (and again) after every
// disconnect. Same shape as the node-cache Baileys uses by default (get/set/del/close).
// Capped at 500 keys with oldest-first eviction: without a cap a long-lived
// process accumulates one entry per retried message id forever.
const MSG_RETRY_MAX = 500
const msgRetryCounterCache = {
	cache: new Map<str, num>(),
	get<T>(key: string): T | undefined {
		return this.cache.get(key) as unknown as T | undefined
	},
	set<T>(key: string, value: T): void {
		this.cache.set(key, value as num)
		if (this.cache.size > MSG_RETRY_MAX) {
			const oldest = this.cache.keys().next().value
			if (oldest !== undefined) this.cache.delete(oldest)
		}
	},
	del(key: string): void {
		this.cache.delete(key)
	},
	flushAll(): void {
		this.cache.clear()
	},
	close(): void {
		this.cache.clear()
	},
}
