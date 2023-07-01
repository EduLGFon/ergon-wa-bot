import { ConnectionState, DisconnectReason } from '@whiskeysockets/baileys';
import type { Boom } from '@hapi/boom';
import BotClient from '../../Client';

export default function (bot: BotClient, update: Partial<ConnectionState>) {
	const { connection, lastDisconnect } = update;

	if (connection !== 'close') return console.log('Conexão estabilizada');

	const shouldReconnect =
		(lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
	// Se o código de erro não for o de logout, deve reconectar

	console.log(`Conexão encerrada por: ${lastDisconnect?.error}`);
	console.log(`tentar reconectar: ${shouldReconnect}`);

	// Reconectar se não caiu por causa de um logout
	if (shouldReconnect) bot.connect();
}
