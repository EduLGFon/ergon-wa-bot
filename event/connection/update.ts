import { type ConnectionState, DisconnectReason } from 'baileys'
import { delay, randomDelay } from '@util/functions.ts'
import { loadEvents } from '@util/handler.ts'
import Collection from '@class/collection.ts'
import { qrcode } from '@libs/qrcode'
import bot from '@plugin/bot.ts'
const MAX_LOGINS_IN_MINUTE = 3
// Keep last logins DateTime to avoid reconecting too fast
const lastLogins = new Collection<num, num>(MAX_LOGINS_IN_MINUTE)

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
			// reconnect if it's not a logout
			if (reconnect === 'wait') {
				print('SOCK', 'Waiting a minute to reconnect...', 'gray')
				await delay(60_000)
				await randomDelay()
			}

			print('SOCK', `Attempting seamless in-memory reconnect`, 'blue')
			const now = Date.now()
			lastLogins.add(now, now)

			// 1. Teardown the old socket to prevent memory leaks and zombie intervals!
			try {
				bot.sock?.ws?.close()
				bot.sock?.end(undefined)
			} catch (_e) {
				// ignore cleanup errors
			}

			// 2. Throttle to avoid WhatsApp rate-limiting during network flaps
			await randomDelay(1_000, 10_000)

			// 3. Connect a fresh socket and bind events to it
			await bot.connect()
			loadEvents().catch((e: Error) => print('HANDLER', 'loadEvents failed:', e.stack, 'red'))
		}
	}
}

function shouldReconnect(code: num) {
	const isLogout = code === DisconnectReason.loggedOut
	if (isLogout) return false
	// does not try to reconnect if session was logged out

	const loginsAvarageDate = lastLogins.reduce((prev, crt) => prev + crt) / MAX_LOGINS_IN_MINUTE
	const oneMinuteAgo = Date.now() - 60_000

	if (loginsAvarageDate > oneMinuteAgo) return 'wait'
	// bot will wait before reconnecting if last MAX_LOGINS_IN_MINUTE logins was one minute ago

	return true
}
