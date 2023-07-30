import makeWASocket, {
	type AnyMessageContent,
	type BaileysEventMap,
	Browsers,
	downloadMediaMessage,
	fetchLatestBaileysVersion,
	GroupMetadata,
	makeCacheableSignalKeyStore,
	type proto,
	useMultiFileAuthState,
} from 'baileys';
// import RequestCode from './RequestCode';
import type { pino } from 'pino';
import { readdirSync } from 'fs'; // DENO point
import { resolve } from 'path';

export default class Bot {
	auth: string;
	logger: pino.Logger<{ timestamp: () => string } & pino.ChildLoggerOptions>;
	sock!: ReturnType<typeof makeWASocket>;
	wait: Map<string, Function>;
	groups: Map<string, GroupMetadata>;
	cmds: Map<string, Command>;
	events: Map<string, Function>;
	aliases: Map<string, string>;

	constructor(auth: string, logger: any) {
		this.logger = logger;
		this.auth = auth; // pasta de autenticação
		this.sock;
		this.wait = new Map<string, Function>();
		// funções arbitrárias q serão chamadas em alguns eventos
		this.groups = new Map<string, GroupMetadata>(); // Map de grupos
		this.events = new Map<string, Function>(); // Map de eventos
		this.cmds = new Map<string, Command>(); // Map de comandos
		this.aliases = new Map<string, string>(); // Map de aliases de comandos
	}

	async connect() {
		const { version } = await fetchLatestBaileysVersion();
		console.log(`WhatsApp v${version.join('.')}`);
		// Puxa a versão mais recente do WhatsApp Web

		const { state, saveCreds } = await useMultiFileAuthState(this.auth);
		// recupera a sessão

		this.sock = makeWASocket({
			auth: {
				creds: state.creds,
				// o cache faz a store enviar/receber msgs mais rápido
				keys: makeCacheableSignalKeyStore(state.keys, this.logger),
			},
			browser: Browsers.macOS('Desktop'),
			logger: this.logger,
			markOnlineOnConnect: false,
			// mobile: true,
			printQRInTerminal: true,
			syncFullHistory: true,
			version,
		});

		// if (process.argv.includes('--mobile')) await RequestCode(this.sock);

		this.sock.ev.on('creds.update', saveCreds);
		// salva as credenciais de login

		// Carregando comandos
		await this.folderHandler(`../Commands`, this.loadCommands);
		// folderHandler() vai ler uma pasta e chamar a função fornecida
		// para cada arquivo contido nela
		this.folderHandler(`../Events`, this.loadEvents);
		// Carregando eventos
	}

	async send(id: string | Msg, body: string | AnyMessageContent, reply?: proto.IWebMessageInfo) {
		// Função intermediária para facilitar o envio de msgs
		const chat = typeof id === 'string' ? id : id.chat;
		const text = typeof body === 'object' ? body : { text: body };
		const quote = reply ? { quoted: reply } : typeof id === 'string' ? {} : { quoted: id?.raw };

		return await this.sock.sendMessage(chat, text, quote);
	}

	async react(m: Msg, emoji: string) { // reage em uma msg
		this.send(m.chat, { react: { text: emoji, key: m.raw.key } });
	}

	async folderHandler(path: string, handler: Function) {
		path = resolve(__dirname, path);

		for (const category of readdirSync(path)) {
			// Para cada pasta de categorias
			for (const file of readdirSync(`${path}/${category}`)) {
				// Para cada arquivo de cada categoria
				const imported = await import(`file:${path}/${category}/${file}`);

				// chama a função fornecida para este arquivo
				await handler.bind(this)(file, category, imported);
			}
		}
	}

	async loadCommands(file: string, _category: string, imported: any) { // DENO point
		const cmd: Command = new imported.default.default();

		const properties = Object.assign({
			name: file.slice(0, -3),
			aliases: [],
			cooldown: 3,
		} as Command, cmd);
		// Isso vai comparar as propriedades do cmd com esse "template"
		// Os dados que o cmd não tiver, serão preenchidas com o default

		properties.access = Object.assign({
			dm: false,
			groups: false,
			onlyDevs: false,
		}, properties.access);
		// Compara as permissões do comando

		// Seta o cmd dentro do Map
		this.cmds.set(properties.name!, properties);

		properties.aliases
			?.forEach((a) => this.aliases.set(a, properties.name!));
		// Seta as aliases do cmd
	}

	async loadEvents(file: string, category: string, imported: any) {
		const event = imported.default.default;
		const name = `${category}.${file.slice(0, -3)}`;
		// as pastas e arquivos seguem a mesma nomenclatura
		// que a lib usa em seus eventos
		this.events.set(name, event);

		// O evento já é declarado aqui
		this.sock.ev.on(name as keyof BaileysEventMap, (...args) => {
			// Mas quando for chamado, vai consultar no Map
			// Isso permite modificar eventos em runtime
			this.events.get(name)!.bind(this)(...args, name);
			// eventFunction(this, ...args);
		});
	}

	async getGroup(id: string) {
		if (this.groups.has(id)) return this.groups.get(id);

		const group = await this.sock.groupMetadata(id);

		if (group) return this.groups.set(id, group) && group;
	}

	async downloadMedia(msg: Msg) {
		return await downloadMediaMessage(msg.raw, 'buffer', {}, {
			logger: this.logger,
			reuploadRequest: this.sock.updateMediaMessage,
		})! as Buffer;
	}
}
