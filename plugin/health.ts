// Deaf-session watchdog.
// A Baileys socket can stay 'open' while WhatsApp silently stops delivering messages - the
// ACK/decryption-mutex deadlock described in upstream issue #2491: keepAlive pings succeed,
// connection.update never fires 'close', yet messages stop arriving. For a mirror bot that is
// the worst failure mode: it fails without any log. This watchdog detects it by tracking the
// last real inbound event and, after a period of silence while connected, running an active
// probe (sock.onWhatsApp) that tells 'quiet' from 'deaf'. A failed probe forces sock.end(),
// which funnels into the guarded reconnect in event/connection/update.ts.
//
// attachHealthWatchdog() is idempotent and re-binds onto the CURRENT socket, so it must be
// re-called after every reconnect (the old socket's listeners die with it).
//
// The same loop emits a periodic HEALTH line (RSS + heap + loop lag +
// queue depth + disconnect counters) so weeks of unattended logs stay
// greppable for leaks and backpressure without a separate monitor.
import { randomDelay } from '@util/functions.ts'
import { memStats } from '@util/proto.ts'
import bot from '@plugin/bot.ts'

const IDLE_SILENCE_MS = 5 * 60 * 1000
const PROBE_TIMEOUT_MS = 25_000
// Randomized schedule between MIN and MAX - a rigid cadence is a passive indicator; a jittered
// interval looks closer to organic traffic.
const PROBE_MIN_MS = 60_000
const PROBE_MAX_MS = 120_000

let started = false
let attachedSock: any = null
// Timestamp of the last real inbound event (or a successful open/probe).
let lastInbound = Date.now()
// Only probe while the socket reports it is connected.
let isConnected = false
let ownedListeners: { name: string; fn: (...args: any[]) => void }[] = []

const markInbound = () => {
	lastInbound = Date.now()
}

export function attachHealthWatchdog(): void {
	const sock: any = bot.sock
	if (!sock) return

	// Detach from a previous socket that is no longer the live one.
	if (attachedSock && attachedSock !== sock) {
		for (const { name, fn } of ownedListeners) {
			try {
				attachedSock.ev.off(name, fn)
			} catch {
				// socket already torn down by the reconnect path
			}
		}
	}
	if (attachedSock === sock) return

	attachedSock = sock
	ownedListeners = []
	const listen = (name: string, fn: (...args: any[]) => void) => {
		sock.ev.on(name, fn)
		ownedListeners.push({ name, fn })
	}

	listen('messages.upsert', markInbound)
	listen('messages.update', markInbound)
	listen('message-receipt.update', markInbound)
	listen('groups.update', markInbound)
	listen('group-participants.update', markInbound)
	listen('connection.update', (u: { connection?: string }) => {
		if (u.connection === 'open') {
			isConnected = true
			markInbound()
		} else if (u.connection === 'close' || u.connection === 'connecting') {
			isConnected = false
		}
	})

	if (!started) {
		started = true
		void probeLoop()
	}
}

async function probeLoop(): Promise<void> {
	for (;;) {
		await randomDelay(PROBE_MIN_MS, PROBE_MAX_MS)
		try {
			await tick()
		} catch (e) {
			print('HEALTH', `watchdog tick failed: ${(e as Error)?.message || e}`, 'yellow')
		}
		try {
			logHealth()
		} catch {
			// health line is best-effort
		}
	}
}

// Periodic resource line: RSS + heap + loop lag + bridge queue pressure +
// disconnect counters + signal error counts. Grep HEALTH to track leaks
// without parsing every SOCK line.
function logHealth(): void {
	try {
		const mem = memStats()
		let queue = 'q=?'
		try {
			// Dynamic import would be async; read via relayCtx when present.
			// Avoid a hard bridge dependency so health works with bridge off.
			// Both lanes report so a business backlog never hides behind
			// a quiet personal queue.
			const { relayCtx } = requireRelayCtx()
			const st = relayCtx?.limiter?.stats?.()
			const shared = relayCtx?.businessLimiter === relayCtx?.limiter ||
				!relayCtx?.businessLimiter
			const bst = shared ? null : relayCtx?.businessLimiter?.stats?.()
			if (st) {
				queue =
					`qP=${st.depth}+${st.parked} drop=${st.dropped} flood=${st.floodRetries} sp=${st.spacing}`
				if (bst) {
					queue +=
						` qB=${bst.depth}+${bst.parked} drop=${bst.dropped} flood=${bst.floodRetries} sp=${bst.spacing}`
				}
			}
		} catch {
			// bridge off - keep q=?
		}
		let drops = ''
		try {
			const { getDisconnectStats } = requireDisconnectStats()
			const s = getDisconnectStats()
			if (s && s.total > 0) drops = ` disc=${s.total}(${s.byCode})`
		} catch {
			// connection module unavailable
		}
		let sig = ''
		try {
			const c = (globalThis as any).__signalErrorCounts as
				| { badMac: number; decryptFail: number; closedSession: number }
				| undefined
			if (c && (c.badMac + c.decryptFail + c.closedSession) > 0) {
				sig = ` sig=badMac:${c.badMac} fail:${c.decryptFail} closed:${c.closedSession}`
			}
		} catch {
			// ignore
		}
		const idleS = Math.round((Date.now() - lastInbound) / 1000)
		print(
			'HEALTH',
			`rss=${mem.rss} heap=${mem.heap} lag=${mem.lag}ms idle=${idleS}s ${queue}${drops}${sig}`,
			'gray',
		)
	} catch {
		// never throw from the health line
	}
}

// Lazy requires avoid import cycles (health <-> bridge/state <-> bot).
function requireRelayCtx(): { relayCtx: any } {
	// @ts-ignore dynamic require for cycle avoidance
	try {
		// deno-lint-ignore no-explicit-any
		const mod = (globalThis as any).__relayCtxMod
		if (mod) return mod
	} catch {
		// fall through
	}
	return { relayCtx: null }
}

function requireDisconnectStats(): { getDisconnectStats: () => { total: number; byCode: string } } {
	try {
		const fn = (globalThis as any).__getDisconnectStats
		if (typeof fn === 'function') return { getDisconnectStats: fn }
	} catch {
		// fall through
	}
	return { getDisconnectStats: () => ({ total: 0, byCode: '' }) }
}

async function tick(): Promise<void> {
	if (!isConnected) return
	const idleFor = Date.now() - lastInbound
	if (idleFor < IDLE_SILENCE_MS) return

	const own = bot.sock?.user?.id
	if (!own) return
	// Bare phone number - matches the liveness probe pattern from the #2491 field report.
	const ownNumber = (own.split(':')[0] || '').split('@')[0]
	if (!ownNumber) return

	let alive = false
	try {
		alive = await Promise.race([
			bot.sock.onWhatsApp(ownNumber).then((res) =>
				(res || []).some((r) => r.exists === true)
			),
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error('probe timeout')), PROBE_TIMEOUT_MS)
			),
		])
	} catch {
		alive = false
	}

	if (alive) {
		// Receive path answered - just quiet, not deaf.
		markInbound()
		return
	}

	print(
		'HEALTH',
		`socket silent for ${Math.round(idleFor / 1000)}s and probe failed - forcing reconnect`,
		'red',
	)
	markInbound() // avoid double-firing before the 'close' event lands
	isConnected = false
	try {
		bot.sock.end(new Error('health: deaf-session'))
	} catch {
		// already closed - the 'close' handler owns recovery
	}
}
