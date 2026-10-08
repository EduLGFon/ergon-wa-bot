// Connection lifecycle: logs QR/open/connecting/close, then performs a guarded seamless
// in-memory reconnect with teardown, code-aware backoff and rate-limit backoff. A reentrancy
// guard prevents overlapping reconnects during WhatsApp 428/503 flaps (a prior leak/zombie
// source), a consecutive-failure cap hands hot reconnect loops to PM2's backoff restart
// instead of spinning forever, and a successful open resets both the attempt counter and the
// sliding rate-limit window.
import { type ConnectionState, DisconnectReason } from 'baileys'
import { delay, randomDelay } from '@util/functions.ts'
import { loadEvents } from '@util/handler.ts'
import { qrcode } from '@libs/qrcode'
import bot from '@plugin/bot.ts'
const MAX_LOGINS_IN_MINUTE = 3
// Cap consecutive failed reconnects: past this the tight 428/500 loop is treated as a
// terminal condition and we exit non-zero so PM2's exponential backoff restart takes over.
// Reconnecting forever in-process looks like abuse to WhatsApp and hammers the account.
const MAX_CONSECUTIVE_RECONNECTS = 8
// Sliding window of recent reconnect timestamps; 3+ within 60s triggers a cooldown wait.
const recentReconnects: num[] = []
// Reentrancy guard: Baileys can emit 'close' twice during flaps; without this two
// bot.connect() run concurrently, leaving zombie sockets and tripping 428 rate limits.
let isReconnecting = false
// Consecutive close events since the last successful open (reset in the 'open' branch).
let consecutiveFails = 0
// Per-code disconnect counters for HEALTH lines: 428 vs 503 tells WA-side
// throttling from server errors without parsing every SOCK line.
const disconnectCounts = new Map<number, number>()

// Exposed for the HEALTH periodic line via globalThis (avoids an import
// cycle: health cannot statically import this module).
export function getDisconnectStats(): { total: number; byCode: string } {
	try {
		let total = 0
		const parts: string[] = []
		for (const [code, n] of [...disconnectCounts.entries()].sort((a, b) => b[1] - a[1])) {
			total += n
			parts.push(`${code}:${n}`)
		}
		return { total, byCode: parts.join(',') }
	} catch {
		return { total: 0, byCode: '' }
	}
}
try {
	;(globalThis as any).__getDisconnectStats = getDisconnectStats
} catch {
	// ignore
}

// connection update event
export default async function (event: Partial<ConnectionState>) {
	const disconnection = event.lastDisconnect?.error as any
	const exitCode = disconnection?.output?.statusCode
	// disconnection code

	if (event.qr) {
		print('SOCK', 'Scan this QR code to login:', 'yellow')
		qrcode(event.qr, { output: 'console' })
	}

	switch (event.connection) {
		case 'open': // bot started
			// Healthy reconnects clear the flap gauges so a good connect never counts
			// toward the 3/min throttle or the consecutive-failure cap.
			consecutiveFails = 0
			recentReconnects.length = 0
			print('SOCK', 'Connection stabilized', 'green')
			return

		case 'connecting':
			return print('SOCK', 'Connecting...', 'gray')

		case 'close': {
			print('SOCK', `Connection lost. Code ${exitCode} - ${disconnection}`, 'red')
			try {
				const code = typeof exitCode === 'number' ? exitCode : -1
				disconnectCounts.set(code, (disconnectCounts.get(code) ?? 0) + 1)
			} catch {
				// stats are best-effort
			}
			const reconnect = shouldReconnect(exitCode)
			if (!reconnect) {
				print('SOCK', 'Logged out', 'red')
				Deno.exit(0)
			}
			if (isReconnecting) {
				// Duplicate close during an ongoing reconnect; the in-flight attempt owns recovery.
				print('SOCK', 'Reconnect already in progress, ignoring duplicate close', 'yellow')
				return
			}
			isReconnecting = true
			try {
				consecutiveFails++
				if (consecutiveFails > MAX_CONSECUTIVE_RECONNECTS) {
					print(
						'SOCK',
						`Too many consecutive reconnects (${consecutiveFails}), exiting for PM2 backoff restart`,
						'red',
					)
					Deno.exit(1)
				}

				// reconnect if it's not a logout
				if (reconnect === 'wait') {
					print('SOCK', 'Waiting a minute to reconnect...', 'gray')
					await delay(60_000)
					await randomDelay()
				}

				print('SOCK', `Attempting seamless in-memory reconnect`, 'blue')
				trackReconnect()

				// 1. Teardown the old socket to prevent memory leaks and zombie intervals!
				try {
					bot.sock?.ev?.removeAllListeners('connection.update')
					bot.sock?.ws?.close()
					bot.sock?.end(undefined)
				} catch (_e) {
					// ignore cleanup errors
				}

				// 2. Code-aware backoff: WhatsApp-specific retry pacing per reason, growing
				// exponentially (capped ~30s) and jittered so flaps don't hit in lockstep.
				const backoffMs = backoffDelay(exitCode, consecutiveFails)
				if (backoffMs > 0) {
					print('SOCK', `Reconnecting in ${(backoffMs / 1000).toFixed(1)}s`, 'gray')
					await delay(backoffMs)
				}

				// 3. Connect a fresh socket and bind events to it.
				// Connect failures (DB down, no network) must not become unhandled
				// rejections that kill or wedge the process; retry once after a pause.
				try {
					await bot.connect()
				} catch (e) {
					print(
						'SOCK',
						`Reconnect connect failed, retrying once: ${(e as Error)?.message || e}`,
						'red',
					)
					await delay(15_000)
					await bot.connect()
				}
				try {
					await loadEvents()
				} catch (e: unknown) {
					print('HANDLER', 'loadEvents failed:', (e as Error)?.stack || String(e), 'red')
				}
				try {
					const { reattachBridge } = await import('@plugin/bridge.ts')
					reattachBridge()
				} catch (e) {
					print('BRIDGE', `reattach failed: ${(e as Error)?.message || e}`, 'red')
				}
				try {
					// Re-bind the deaf-session watchdog to the fresh socket (its listeners
					// died with the old one).
					const { attachHealthWatchdog } = await import('@plugin/health.ts')
					attachHealthWatchdog()
				} catch (e) {
					print(
						'HEALTH',
						`watchdog reattach failed: ${(e as Error)?.message || e}`,
						'yellow',
					)
				}
			} catch (e) {
				// Keep the process alive; the next 'close' or manual restart owns recovery.
				print('SOCK', `Reconnect failed: ${(e as Error)?.message || e}`, 'red')
			} finally {
				isReconnecting = false
			}
		}
	}
}

// WhatsApp-specific retry pacing per disconnect reason. The 2/4/8/15s bases come from
// upstream field reports (428 -> short grace, 503 -> leave the server alone, 440/500 ->
// back off, another device/session fight). Grows exponentially, capped at 30s, jittered.
function backoffDelay(code: num | undefined, attempts: num): num {
	const base = code === DisconnectReason.connectionLost || code === DisconnectReason.timedOut
		? 2_000
		: code === DisconnectReason.restartRequired
		? 2_000
		: code === DisconnectReason.connectionClosed
		? 4_000
		: code === DisconnectReason.unavailableService
		? 8_000
		: code === DisconnectReason.connectionReplaced ||
				code === DisconnectReason.badSession ||
				code === DisconnectReason.forbidden
		? 15_000
		: 5_000
	const expo = Math.min(base * Math.pow(2, attempts - 1), 30_000)
	// +/-50% jitter keeps reconnect storms from syncing across clients.
	return Math.round(expo * (0.5 + Math.random()))
}

function shouldReconnect(code: num) {
	const isLogout = code === DisconnectReason.loggedOut
	if (isLogout) return false
	// does not try to reconnect if session was logged out

	pruneReconnects()
	if (recentReconnects.length >= MAX_LOGINS_IN_MINUTE) return 'wait'
	// bot will wait before reconnecting if last MAX_LOGINS_IN_MINUTE reconnects were within a minute

	return true
}

function trackReconnect() {
	recentReconnects.push(Date.now())
	pruneReconnects()
}

function pruneReconnects() {
	const oneMinuteAgo = Date.now() - 60_000
	while (recentReconnects.length && recentReconnects[0] < oneMinuteAgo) recentReconnects.shift()
}
