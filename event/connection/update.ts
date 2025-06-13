import { Baileys, cacheAllGroups, Collection, delay } from '../../map.js'
import { type ConnectionState, DisconnectReason } from 'baileys'
import QRCode from 'qrcode'
import bot from '../../wa.js'

// Keep last 5 logins DateTime
const lastLogins = new Collection<num, num>(5)

// connection update event
export default async function (event: Partial<ConnectionState>) {
	const disconnection = event.lastDisconnect?.error as any
	const exitCode = disconnection?.output?.statusCode
	// disconnection code

	if (event.qr) {
		console.log(await QRCode.toString(event.qr, { type: 'terminal' }))
	}

	switch (event.connection) {
		case 'open': // bot started
			// don't show online mark when bot is running
			bot.sock.sendPresenceUpdate('unavailable')
			print('NET', 'Connection stabilized', 'green')

			// let timeout = cache.timeouts.get('cacheAllGroups')
			// clearInterval(timeout)

			// timeout = setTimeout(() => cacheAllGroups(bot), 15_000)
			// cache.timeouts.set('cacheAllGroups', timeout)
			/** Why did I do that?
			 * Cuz connection could reconnect several times and this event
			 * will be triggered several times too. So, all groups will
			 * be cached several times... You know what I'm doing here.
			 * Just avoiding rate-overlimit by stopping old timeouts and keeping
			 * only one of them.
			 */
			return

		case 'connecting':
			return print('NET', 'Connecting...', 'gray')

		case 'close':
			print('CLOSED', `Reason (${exitCode}): ${disconnection}`, 'blue')

			const reconnect = shouldReconnect(exitCode)

			// reconnect if it's not a logout
			if (reconnect) {
				if (reconnect === 'wait') {
					print('NET', 'Waiting a minute to reconnect...', 'gray')
					await delay(60_000)
				}

				const now = Date.now()
				lastLogins.add(now, now)
				bot.connect()
			}
			return
	}
	return
}

function shouldReconnect(code: num) {
	const isLogout = code === DisconnectReason.loggedOut
	if (isLogout) return false
	// does not try to reconnect if session was logged out

	const loginsAvarageDate = lastLogins.reduce((prev, crt) => prev + crt) / 5
	const oneMinuteAgo = Date.now() - 60_000

	if (loginsAvarageDate > oneMinuteAgo) return 'wait'
	// bot will wait before reconnecting if last 5 logins was one minute ago

	return true
}
