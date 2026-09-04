// Connection lifecycle: logs QR/open/connecting/close, then performs a guarded seamless
// in-memory reconnect with teardown, throttling and rate-limit backoff. A reentrancy guard
// prevents overlapping reconnects during WhatsApp 428/503 flaps (a prior leak/zombie source).
import { type ConnectionState, DisconnectReason } from 'baileys'
import { delay, randomDelay } from '@util/functions.ts'
import { loadEvents } from '@util/handler.ts'
import { qrcode } from '@libs/qrcode'
import bot from '@plugin/bot.ts'
const MAX_LOGINS_IN_MINUTE = 3
// Sliding window of recent reconnect timestamps; 3+ within 60s triggers a cooldown wait.
const recentReconnects: num[] = []
// Reentrancy guard: Baileys can emit 'close' twice during flaps; without this two
// bot.connect() run concurrently, leaving zombie sockets and tripping 428 rate limits.
let isReconnecting = false

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
			print('SOCK', 'Connection stabilized', 'green')
			return

		case 'connecting':
			return print('SOCK', 'Connecting...', 'gray')

		case 'close': {
			print('SOCK', `Connection lost. Code ${exitCode} - ${disconnection}`, 'red')
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

				// 2. Throttle to avoid WhatsApp rate-limiting during network flaps
				await randomDelay(1_000, 10_000)

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
			} catch (e) {
				// Keep the process alive; the next 'close' or manual restart owns recovery.
				print('SOCK', `Reconnect failed: ${(e as Error)?.message || e}`, 'red')
			} finally {
				isReconnecting = false
			}
		}
	}
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
