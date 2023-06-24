import makeWASocket, { AnyMessageContent, BaileysEventMap, ConnectionState, DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys';
import type { Boom } from '@hapi/boom';
import { readdirSync } from 'fs'; // DENO point

export default class BotClient {
	authFile: string;
	sock!: ReturnType<typeof makeWASocket>;
	commands: Map<string, Command>;
	events: Map<string, Function>;

	constructor(authFile: string) {
		this.authFile = authFile; // arquivo de autenticação
		this.sock;
		this.events = new Map<string, Function>();
		this.commands = new Map<string, Command>();
	}

	async connect() {
		const { state, saveCreds } = await useMultiFileAuthState(this.authFile);
		// recupera a sessão
		this.sock = makeWASocket({ auth: state, printQRInTerminal: true });
		// abre o socket
		this.sock.ev.on('creds.update', saveCreds);
		// atualiza as credenciais de login

		await this.fileHandler(`${__dirname}/Commands`, this.loadCommands);
		// Carrega os comandos
		this.fileHandler(`${__dirname}/Events`, this.loadEvents);
		// Carrega os eventos
	}

	async send(id: string, content: string | AnyMessageContent) {
		return await this.sock.sendMessage(id!, typeof content === 'string' ? { text: content } : content);
	}

	async fileHandler(path: string, handler: Function) {
		for (const category of readdirSync(path)) {
			// Para cada pasta de categorias
			for (const file of readdirSync(`${path}/${category}`)) {
				// Para cada arquivo de cada categoria
				const imported = await import(`file:${path}/${category}/${file}`);

				handler.bind(this)(file, category, imported);
			}
		}
	}

	async loadCommands(file: string, category: string, imported: any) { // DENO point
		const cmd: Command = new imported.default.default();

		const properties = Object.assign({
			name: file.slice(0, -3),
			aliases: [],
			cooldown: 3,
		} as Command, cmd);
		// Isso vai comparar as propriedades do cmd com esse "template"
		// Os dados que o cmd não tiver, serão preenchidas

		properties.access = Object.assign({
			dm: false,
			groups: false,
			onlyDevs: false,
		}, properties.access);
		// Compara as permissões do comando

		this.commands.set(properties.name!, properties);
		// Salva o comando no Map
	}

	async loadEvents(file: string, category: string, imported: any) {
		const event = imported.default.default;
		const name = `${category}.${file.slice(0, -3)}`;
		// os nomes dos arquivos e pastas são exatamente os nomes dos eventos
		this.events.set(name, event);

		this.sock.ev.on(name as keyof BaileysEventMap, (...args) => {
			this.events.get(name)!(this, ...args);
		});
	}
}
