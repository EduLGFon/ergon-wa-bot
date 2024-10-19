import makeWASocket, {
	AnyMessageContent,
	BaileysEventMap,
	fetchLatestBaileysVersion,
	makeCacheableSignalKeyStore,
	makeInMemoryStore,
	proto,
	useMultiFileAuthState,
	WAMessageContent,
	WAMessageKey,
} from 'baileys';
import RequestCode from './Core/RequestCode';
import NodeCache from 'node-cache';
import { readdirSync } from 'fs'; // DENO point
import type { pino } from 'pino';

export default class BotClient {
	auth: string;
	logger: pino.Logger<{ timestamp: () => string } & pino.ChildLoggerOptions>;
	sock!: ReturnType<typeof makeWASocket>;
	store!: ReturnType<typeof makeInMemoryStore>;
	cmds: Map<string, Command>;
	events: Map<string, Function>;
	aliases: Map<string, string>;

	constructor(auth: string, logger: any, store: any) {
		this.logger = logger;
		this.store = store;
		this.auth = auth; // pasta de autenticação
		this.sock;
		this.events = new Map<string, Function>(); // Map de eventos
		this.cmds = new Map<string, Command>(); // Map de comandos
		this.aliases = new Map<string, string>(); // Map de aliases de comandos
	}

	async connect() {
		this.store?.readFromFile('./baileys_store_multi.json');

		// Salva a cada 10s
		setInterval(() => this.store?.writeToFile('./baileys_store_multi.json'), 10_000);

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
			getMessage: this.getMessage,
			logger: this.logger,
			markOnlineOnConnect: false,
			// mobile: true,
			msgRetryCounterCache: new NodeCache(),
			printQRInTerminal: true,
			version,
		});
		// abre o socket
		this.store?.bind(this.sock.ev);

		if (process.argv.includes('--mobile')) await RequestCode(this.sock);

		this.sock.ev.on('creds.update', saveCreds);
		// salva as credenciais de login

		// Carregando comandos
		await this.folderHandler(`${__dirname}/Commands`, this.loadCommands);
		// folderHandler() vai ler uma pasta e chamar a função fornecida
		// para cada arquivo contido nela
		this.folderHandler(`${__dirname}/Events`, this.loadEvents);
		// Carregando eventos
	}

	async send(chatId: string, content: string | AnyMessageContent, reply?: proto.IWebMessageInfo) {
		// Função intermediária para facilitar o envio de msgs
		return await this.sock.sendMessage(
			chatId!, // ID do chat
			typeof content === 'string' ? { text: content } : content,
			// corpo da solicitação
			reply ? { quoted: reply! } : {},
			// Msg a ser respondida
		);
	}

	async react(m: Msg, emoji: string) { // reage em uma msg
		this.send(m.chat, { react: { text: emoji, key: m.raw.key } });
	}

	async folderHandler(path: string, handler: Function) {
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

	async loadCommands(file: string, category: string, imported: any) { // DENO point
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
			this.events.get(name)!(this, ...args);
			// eventFunction(this, ...args);
		});
	}

	async getMessage(key: WAMessageKey): Promise<WAMessageContent | undefined> {
		if (this.store) { // Puxa uma mensagem da Store
			const msg = await this.store.loadMessage(key.remoteJid!, key.id!);
			return msg?.message || undefined;
		}

		return proto.Message.fromObject({});
	}
}
