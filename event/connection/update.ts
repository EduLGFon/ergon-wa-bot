import { type ConnectionState, DisconnectReason } from 'baileys'
import { Baileys, cacheAllGroups } from '../../map.js'

// connection update event
export default async function (bot: Baileys, update: Partial<ConnectionState>) {
	const { connection, lastDisconnect } = update

	switch (connection) {
		case 'open':
			cacheAllGroups(bot)
			// don't show online mark when the bot is running
			bot.sock.sendPresenceUpdate('unavailable')

			return print('WEBSOCKET', 'Connection stabilized', 'green')

		case 'connecting':
			return print('WEBSOCKET', 'Connecting...', 'gray')

		case 'close':
			const shouldReconnect = (lastDisconnect?.error as any)?.output?.statusCode !==
				DisconnectReason.loggedOut // disconnect status code

			console.error(`Connection closed by: ${lastDisconnect?.error}`)
			print(
				'WEBSOCKET',
				`Should try to reconnect: ${shouldReconnect}`,
				'blue',
			)

			// reconnect if it's not a logout
			if (shouldReconnect) bot.connect()
			return
	}
	return
}
