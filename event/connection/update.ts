import { type ConnectionState, DisconnectReason } from 'baileys'
import { Baileys, cacheAllGroups, Collection, delay } from '../../map.js'

// Keep last 5 logins DateTime
const lastLogins = new Collection<num, num>(5)

// connection update event
export default async function (bot: Baileys, event: Partial<ConnectionState>) {
	const disconnection = event.lastDisconnect?.error as any
	const exitCode = disconnection?.output?.statusCode
	// disconnection code

	switch (event.connection) {
		case 'open': // bot started
			// don't show online mark when bot is running
			bot.sock.sendPresenceUpdate('unavailable')
			print('NET', 'Connection stabilized', 'green')

			await delay(15_000)
			cacheAllGroups(bot)
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

				lastLogins.add(Date.now())
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
