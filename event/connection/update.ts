import { type ConnectionState, DisconnectReason } from 'baileys'
import { randomDelay } from '../../util/functions.ts'
import { loadEvents } from '../../util/handler.ts'
import { Collection, delay } from '../../map.ts'
import bot from '../../wa.ts'
import QRCode from 'qrcode'

const MAX_LOGINS_IN_MINUTE = 3
// Keep last logins DateTime to avoid reconecting too fast
const lastLogins = new Collection<num, num>(MAX_LOGINS_IN_MINUTE)

// connection update event
export default async function (event: Partial<ConnectionState>) {
	const disconnection = event.lastDisconnect?.error as any
	const exitCode = disconnection?.output?.statusCode
	// disconnection code

	if (event.qr) {
		print('QR', 'Scan this QR code to login:', 'yellow')
		print(await QRCode.toString(event.qr, { type: 'terminal' }))
	}

	switch (event.connection) {
		case 'open': // bot started
			print('SOCK', 'Connection stabilized', 'green')
			return

		case 'connecting':
			return print('SOCK', 'Connecting...', 'gray')

		case 'close': {
			print('CLOSED', `Reason (${exitCode}): ${disconnection}`, 'blue')

			const reconnect = shouldReconnect(exitCode)

			if (!reconnect) return print('WA', 'Logged out', 'red')
			// reconnect if it's not a logout
			if (reconnect === 'wait') {
				print('SESSION', 'Waiting a minute to reconnect...', 'gray')
				await delay(60_000)
				await randomDelay()
			}

			const now = Date.now()
			lastLogins.add(now, now)
			await bot.connect()
			loadEvents().catch((e: Error) => print('HANDLER', 'loadEvents failed:', e.stack, 'red'))
			return
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
