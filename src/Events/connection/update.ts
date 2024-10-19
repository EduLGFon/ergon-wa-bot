import { type ConnectionState, DisconnectReason } from 'baileys';
import { cacheAllGroups } from '../../Components/Core/Utils';
import type bot from '../../Components/Classes/Bot';
import type { Boom } from '@hapi/boom';

export default async function (this: bot, update: Partial<ConnectionState>) {
	const { connection, lastDisconnect } = update;

	switch (connection) {
		case 'open':
			await cacheAllGroups(this);
			// don't show online mark when the bot is running
			await this.sock.sendPresenceUpdate('unavailable');

			return console.log('Connection stabilized');

		case 'connecting':
			return console.log('Connecting...');
		case 'close':
			const shouldReconnect =
				(lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;

			console.log(`Connection closed by:`, lastDisconnect?.error);
			console.log(`Should try to reconnect: ${shouldReconnect}`);

			// reconnect if it's not a logout
			if (shouldReconnect) this.connect();
	}
}
