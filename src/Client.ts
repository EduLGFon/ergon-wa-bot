import makeWASocket, { AnyMessageContent, ConnectionState, DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys';
import type { Boom } from '@hapi/boom';

export default class BotClient {
	events: {
		msgUpsert: (m: Msg) => Promise<void>;
	};
	authFile: string;
	prefix: string;
	sock!: ReturnType<typeof makeWASocket>;
	commands: Map<string, Command>;

	constructor(authFile: string, prefix: string) {
		this.authFile = authFile;
		this.prefix = prefix;
		this.sock;
		this.events = {
			msgUpsert: async (m) => {},
		};
		this.commands = new Map<string, Command>();
	}

	async connect() {
		const { state, saveCreds } = await useMultiFileAuthState(this.authFile);
		this.sock = makeWASocket({ auth: state, printQRInTerminal: true });
		this.sock.ev.on('creds.update', saveCreds);

		this.sock.ev.on('connection.update', (update: Partial<ConnectionState>) => {
			const { connection, lastDisconnect } = update;
			if (connection === 'close') {
				const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !==
					DisconnectReason.loggedOut;
				console.log(
					'connection closed due to ',
					lastDisconnect?.error,
					', reconnecting ',
					shouldReconnect,
				);
				// reconnect if not logged out
				if (shouldReconnect) this.connect();
			} else console.log('opened connection');
		});

		this.sock.ev.on('messages.upsert', (m) => {
			let timestamp = String(m.messages[0].messageTimestamp);

			while (timestamp.length < 13) {
				timestamp += '0';
			}

			const msg: Msg = {
				id: m.messages[0].key.id!,
				chat: m.messages[0].key.remoteJid!,
				participant: m.messages[0].key.participant!,
				timestamp: Number(timestamp),
				username: m.messages[0].pushName!,
				text: m.messages[0].message?.conversation!,
				status: m.messages[0].status!,
			};

			this.events.msgUpsert(msg);
		});
	}

	async send(id: string, content: string | AnyMessageContent) {
		return await this.sock.sendMessage(id!, typeof content === 'string' ? { text: content } : content);
	}

	loadCommands() {
	}
}
