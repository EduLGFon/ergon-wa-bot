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
import { getCachedGroupMeta, setCachedGroupMeta } from '@class/groupMeta.ts'
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

// Baileys reads config.version as a [major, minor, patch] tuple: validate-connection.js
// calls config.version.join('.') for the registration node. Any other shape (an upstream
// shape change, a string from a config source) throws
// `TypeError: config.version.join is not a function`, surfaces as a close event with
// `Code undefined`, and loops the reconnect path (30/10 out.log: 6x in ~50s).
// normalizeVersion coerces every plausible shape to a fresh tuple and returns null when
// nothing usable remains, so makeWASocket always gets the shape Baileys requires.
function normalizeVersion(v: unknown): [number, number, number] | null {
	const triple = (parts: unknown[]): [number, number, number] | null => {
		if (parts.length !== 3) return null
		const nums = parts.map((p) =>
			typeof p === 'number' ? p : typeof p === 'string' && p.trim() !== '' ? Number(p) : NaN
		)
		if (!nums.every((n) => Number.isFinite(n))) return null
		return [nums[0], nums[1], nums[2]]
	}
	if (Array.isArray(v)) return triple(v)
	if (typeof v === 'string') return triple(v.trim().split('.'))
	if (v && typeof v === 'object') {
		const o = v as Record<string, unknown>
		const major = o[0] ?? o.major ?? o.primary
		const minor = o[1] ?? o.minor ?? o.secondary
		const patch = o[2] ?? o.patch ?? o.tertiary
		return triple([major, minor, patch])
	}
	return null
}

async function resolveVersion(): Promise<[number, number, number]> {
	const now = Date.now()
	if (cachedVersion && now - cachedAt < VERSION_REFRESH_MS) return cachedVersion

	const prev = cachedVersion
	let next: [number, number, number] | null = null
	// 1. Baileys repo pin - authoritative, refreshed upstream (#2728 fixed its staleness).
	try {
		const { version } = await fetchLatestBaileysVersion()
		next = normalizeVersion(version)
		if (next) cachedSource = 'baileys'
	} catch {
		// fall through to the live source
	}
	// 2. Live client_revision from web.whatsapp.com/sw.js - what servers currently expect.
	if (!next) {
		try {
			const { version } = await fetchLatestWaWebVersion()
			next = normalizeVersion(version)
			if (next) cachedSource = 'wa web'
		} catch {
			// fall through to the pinned last-resort
		}
	}
	if (next) {
		cachedVersion = next
	} else if (prev) {
		// Transient fetch failure on reconnect: keep the last known-good version
		// instead of dropping to the stale pin.
		cachedVersion = prev
		if (!cachedSource.endsWith('(stale)')) cachedSource += ' (stale)'
	} else {
		cachedVersion = [...FALLBACK_WA_VERSION]
		cachedSource = 'pinned fallback'
	}
	cachedAt = Date.now()
	return cachedVersion
}

// Reconnect-race guard: Baileys query paths throw Boom 428 Connection Closed when the
// socket is closed (Socket/socket.js sendRawMessage/waitForMessage). During 428/503 flaps
// background queries (USync device fetch, LID pnToLID, media-conn refresh) raced the
// teardown and surfaced as unhandled rejections (CRASH ... kept alive). Gate the choke
// points: while the ws is still connecting, wait for it to open (queue); once it is
// closed for good, degrade to the empty result every caller already handles instead of
// throwing 428 into a caller that will not catch it.
// Upper bound for the wait-for-open queue: a reconnect (backoff capped at 30s plus
// connect) can legitimately take longer, in which case the caller degrades to the
// empty result instead of hanging a sender or an inflight limiter slot forever.
const WAIT_OPEN_TIMEOUT_MS = 15_000
function guardClosedSocketQueries(sock: WASocket) {
	const isOpen = () => {
		try {
			return !!sock.ws?.isOpen
		} catch {
			return false
		}
	}
	// A 428 raised only because the ws is (now) closed - anything else rethrows untouched.
	const isClosedRace = (e: unknown) =>
		!isOpen() &&
		((e as { output?: { statusCode?: unknown } })?.output?.statusCode === 428 ||
			(e as Error)?.message === 'Connection Closed')
	const waitOpen = async () => {
		let timer: ReturnType<typeof setTimeout> | undefined
		try {
			await Promise.race([
				// Throws immediately when the ws is closed/closing; waits for 'open'
				// while a fresh socket is still connecting. The timer bounds the
				// queue so a socket that never opens cannot hang the caller.
				sock.waitForSocketOpen(),
				new Promise<void>((resolve) => {
					timer = setTimeout(resolve, WAIT_OPEN_TIMEOUT_MS)
				}),
			])
		} catch {
			// closed for good - the callers below degrade instead of throwing
		} finally {
			if (timer !== undefined) clearTimeout(timer)
		}
	}
	const innerUSync = sock.executeUSyncQuery.bind(sock)
	sock.executeUSyncQuery = (async (q: Parameters<typeof innerUSync>[0]) => {
		if (!isOpen()) {
			await waitOpen()
			// getUSyncDevices checks `if (result)`; pnFromLIDUSync falls back to [];
			// onWhatsApp falls back to [] - undefined is the safe empty result here.
			if (!isOpen()) return undefined
		}
		try {
			return await innerUSync(q)
		} catch (e) {
			if (isClosedRace(e)) {
				print('SOCK', 'USync skipped: socket closed mid-query', 'yellow')
				return undefined
			}
			throw e
		}
	}) as typeof sock.executeUSyncQuery
	const innerMediaConn = sock.refreshMediaConn.bind(sock)
	sock.refreshMediaConn = (async (force?: boolean) => {
		if (!isOpen()) await waitOpen()
		// Still closed: delegate and let the natural 428 propagate (unchanged behavior).
		// The common connecting-window race is absorbed by the wait above.
		return await innerMediaConn(force)
	}) as typeof sock.refreshMediaConn
	// pnToLIDFunc is Baileys' USync injection point (socket.js pnFromLIDUSync, handed to
	// the LID mapping store); declared private in the .d.ts but a plain field at runtime.
	// [] means "no mapping", which the store logs and degrades from without throwing.
	const lidStore = sock.signalRepository?.lidMapping as unknown as {
		pnToLIDFunc?: (jids: string[]) => Promise<unknown>
	} | undefined
	const innerPnToLid = lidStore?.pnToLIDFunc
	if (lidStore && innerPnToLid) {
		lidStore.pnToLIDFunc = async (jids) => {
			if (!isOpen()) {
				await waitOpen()
				if (!isOpen()) return []
			}
			try {
				return await innerPnToLid(jids)
			} catch (e) {
				if (isClosedRace(e)) {
					print('SOCK', 'LID lookup skipped: socket closed mid-query', 'yellow')
					return []
				}
				throw e
			}
		}
	}
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
			// Collapse per-send groupMetadata IQ queries into a TTL cache.
			// Without this every group sendMessage costs a live query and
			// bulk ops (e.g. .clean) trip WhatsApp's 429 rate-overlimit.
			// On miss/expiry we fetch once, cache it and hand it over;
			// a fetch failure returns undefined so Baileys falls back to
			// its live query path instead of breaking the send.
			cachedGroupMetadata: async (jid: string) => {
				const hit = getCachedGroupMeta(jid)
				if (hit) return hit
				try {
					const meta = await this.sock.groupMetadata(jid)
					setCachedGroupMeta(jid, meta)
					return meta
				} catch {
					return undefined
				}
			},
			// ignore useless msgs
			shouldIgnoreJid: (jid: str) =>
				isJidBot(jid) ||
				isJidBroadcast(jid) ||
				isJidNewsletter(jid) ||
				isJidMetaAI(jid) ||
				isJidStatusBroadcast(jid),
		})

		// Gate Baileys background queries (USync, media-conn, LID lookup) so they wait
		// out a connecting socket or degrade while it is closed instead of throwing
		// 428 Connection Closed into callers that will not catch it.
		guardClosedSocketQueries(this.sock)

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
