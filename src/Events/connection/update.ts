import { type ConnectionState, DisconnectReason } from 'baileys';
import { cacheAllGroups } from '../../Core/Utils';
import type { Boom } from '@hapi/boom';
import type bot from '../../Core/Bot';

export default async function (this: bot, update: Partial<ConnectionState>) {
	const { connection, lastDisconnect } = update;

	switch (connection) {
		case 'open':
			await cacheAllGroups(this);
			await this.sock.sendPresenceUpdate('unavailable');

			return console.log('Conexão estabilizada');

		case 'connecting':
			return console.log('Conectando...');
		case 'close':
			const shouldReconnect =
				(lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
			// Se o código de erro não for o de logout, deve reconectar

			console.log(`Conexão encerrada por:`, lastDisconnect?.error);
			console.log(`Deve tentar reconectar: ${shouldReconnect}`);

			// Reconectar se não caiu por causa de um logout
			if (shouldReconnect) this.connect();
	}
}
