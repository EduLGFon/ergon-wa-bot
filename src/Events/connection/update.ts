import { type ConnectionState, DisconnectReason } from 'baileys';
import { cacheAllGroups } from '../../Core/Components/Utils.js';
import type bot from '../../Core/Classes/Bot.js';
import type { Boom } from '@hapi/boom';

export default async function (bot: bot, update: Partial<ConnectionState>) {
	const { connection, lastDisconnect } = update;

	switch (connection) {
		case 'open':
			cacheAllGroups(bot);
			// don't show online mark when the bot is running
			bot.sock.sendPresenceUpdate('unavailable');

			return console.log('WEBSOCKET', 'Connection stabilized', 'green');

		case 'connecting':
			return console.log('WEBSOCKET', 'Connecting...', 'gray');

		case 'close':
			const shouldReconnect =
				(lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;

			console.error(`Connection closed by: ${lastDisconnect?.error}`);
			console.log('WEBSOCKET', `Should try to reconnect: ${shouldReconnect}`, 'blue');

			// reconnect if it's not a logout
			if (shouldReconnect) bot.connect();
			return;
	}
	return;
}
