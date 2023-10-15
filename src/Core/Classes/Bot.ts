import {
	type AnyMessageContent,
	type BaileysEventMap,
	Browsers,
	downloadMediaMessage,
	fetchLatestBaileysVersion,
	makeCacheableSignalKeyStore,
	makeWASocket,
	type proto,
	useMultiFileAuthState,
	type WASocket,
} from 'baileys';
// import RequestCode from './RequestCode';
import type { Cmd, Logger, Msg } from '../Typings/index.d.ts';
import Collection from '../Plugins/Collection.js';
import { getCtx } from '../Components/Utils.js';
import { readdirSync } from 'node:fs'; // DENO point
import { resolve } from 'node:path';
import Command from './Command.js';
import Group from './Group.js';
import User from './User.js';

export default class Bot {
	sock!: WASocket;
	wait: Collection<string, Function>;
	groups: Collection<string, Group>;
	users: Collection<string, User>;
	events: Collection<string, Function>;
	cmds: Collection<string, Cmd>;
	aliases: Collection<string, string>;

	constructor(public auth: str, public logger: Logger) {
		this.logger = logger;
		this.auth = auth; // auth folder
		this.sock;
		this.wait = new Collection(Function);
		// arbitrary functions that can be called on events
		this.users = new Collection(User, 500); // Users collection
		this.groups = new Collection(Group, 500); // Groups collection
		this.events = new Collection(Function); // Events collection
		this.cmds = new Collection(Command); // Cmds collection
		this.aliases = new Collection(String); // Cmd aliases map
	}

	async connect() {
		const { version } = await fetchLatestBaileysVersion();
		console.log('WEBSOCKET', `Connecting to WA v${version.join('.')}`, 'green');
		// Fetch latest WA version

		const { state, saveCreds } = await useMultiFileAuthState(this.auth);
		// Use saved session

		this.sock = makeWASocket({
			auth: {
				creds: state.creds,
				// cache makes the store send/receive msgs faster
				keys: makeCacheableSignalKeyStore(state.keys, this.logger),
			},
			browser: Browsers.macOS('Desktop'),
			logger: this.logger,
			markOnlineOnConnect: false,
			// mobile: true,
			printQRInTerminal: true,
			syncFullHistory: true,
			// ignore status updates
			shouldIgnoreJid: (jid: str) => jid?.includes('broadcast'),
			version,
		});

		// if (process.argv.includes('--mobile')) await RequestCode(this.sock);

		this.sock.ev.on('creds.update', saveCreds);
		// save login creds

		// Loading commands
		this.folderHandler(`./build/Commands`, this.loadCommands);
		// folderHandler() reads a folder and call the function
		// for each file
		this.folderHandler(`./build/Events`, this.loadEvents);
		// Loading Events
	}

	async send(id: str | Msg, body: str | AnyMessageContent, reply?: proto.IWebMessageInfo) {
		// Intermediate function to send msgs easier
		const chat = typeof id === 'string' ? id : id.chat;
		const text = typeof body === 'object' ? body : { text: body };
		const quote = reply ? { quoted: reply } : typeof id === 'string' ? {} : { quoted: id?.raw };

		const msg = await this.sock.sendMessage(chat, text, quote);

		return await getCtx(msg!, this);
	}

	async react(m: Msg, emoji: str) { // reacts on a msg
		return await this.send(m.chat, { react: { text: emoji, key: m.raw.key } });
	}

	async folderHandler(path: str, handler: Function) {
		path = resolve(path);
		let counter = 0;

		for (const category of readdirSync(path)) {
			// For each category folder
			for (const file of readdirSync(`${path}/${category}`)) {
				// for each file of each category
				const imported = await import(`file://${path}/${category}/${file}`);

				// call function to this file
				handler.bind(this)(file, category, imported.default);
				counter++;
			}
		}

		console.log(
			'HANDLER',
			`${counter} ${path.includes('Commands') ? 'commands' : 'events'} loaded`,
			'magentaBright',
		);
		return;
	}

	async loadCommands(file: str, _category: str, imported: any) { // DENO point
		const cmd: Cmd = new imported();
		cmd.name = file.slice(0, -3);

		const properties = Object.assign({
			name: '',
			aliases: [],
			cooldown: 3,
			run: cmd.run,
		} as Cmd, cmd);
		// Compare cmd properties with a 'template base'
		// Fill missing data with default data

		// Set cmd
		this.cmds.set(properties.name!, properties);

		properties.aliases
			?.forEach((a) => this.aliases.set(a, properties.name!));
		// Set cmd aliases
	}

	async loadEvents(file: str, category: str, imported: any) {
		const event = imported;
		const name = `${category}.${file.slice(0, -3)}`;
		// folder/file names are the same of lib events
		this.events.set(name, event);

		// Listen to the event here
		this.sock.ev.on(name as keyof BaileysEventMap, (...args) => {
			// It allows to modify events in run time
			this.events.get(name)!.bind(this)(...args, name);
			// eventFunction(this, ...args);
		});
	}

	async getGroup(id: str) {
		// check group cache
		let group = this.groups.get(id);
		if (group) return group;

		// fetch group data
		group = await this.sock.groupMetadata(id);

		// set group data and return it
		if (group) {
			this.groups.set(group.id, group);
			return group;
		}
	}

	async downloadMedia(msg: Msg) {
		const media = await downloadMediaMessage(msg.raw, 'buffer', {}, {
			logger: this.logger,
			reuploadRequest: this.sock.updateMediaMessage,
		})! as Buffer;

		return media || await this.sock.updateMediaMessage(msg.raw);
	}
}
