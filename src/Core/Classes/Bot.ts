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
import type { Logger, Msg } from '../Typings/types.js';
import { getCtx, getMsgMeta } from '../Components/Utils.js';
import Collection from '../Plugins/Collection.js';
import { readdirSync } from 'node:fs'; // DENO point
import { resolve } from 'node:path';
import Cmd from './Command.js';
import Group from './Group.js';
import User from './User.js';
// import bc from '../Components/WorkerUtil.js';

export default class Bot {
	sock!: WASocket;
	// bc!: bc;

	// Collections (Stored data)
	cmds: Collection<string, Cmd>;
	users: Collection<string, User>;
	groups: Collection<string, Group>;
	wait: Collection<string, Function>;
	aliases: Collection<string, string>;
	events: Collection<string, Function>;

	constructor(public auth: str, public logger: Logger) {
		this.logger = logger;
		this.auth = auth; // auth folder

		// wait: arbitrary functions that can be called on events
		this.wait = new Collection(0);
		// Users collection
		this.users = new Collection(100, User);
		// Groups collection
		this.groups = new Collection(500, Group);
		// Events collection (0 means no limit)
		this.events = new Collection(0);
		// Cmds collection
		this.cmds = new Collection(0, Cmd);
		// Cmd aliases map
		this.aliases = new Collection(0);
	}

	async connect() {
		// Fetch latest WA version
		const { version } = await fetchLatestBaileysVersion();
		console.log('WEBSOCKET', `Connecting to WA v${version.join('.')}`, 'green');

		// Use saved session
		const { state, saveCreds } = await useMultiFileAuthState(this.auth);

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
			syncFullHistory: false,
			// ignore status updates
			shouldIgnoreJid: (jid: str) => jid?.includes('broadcast'),
			version,
		});

		// if (process.argv.includes('--mobile')) await RequestCode(this.sock);

		// save login creds
		this.sock.ev.on('creds.update', saveCreds);

		// Load commands*
		this.folderHandler(`./build/Commands`, this.loadCmds);
		// * folderHandler() will read a folder and call the function
		// for each file

		// Load events
		this.folderHandler(`./build/Events`, this.loadEvents);
	}

	// Send: Intermediate function to send msgs easier
	async send(id: str | Msg, body: str | AnyMessageContent, reply?: proto.IWebMessageInfo) {
		let { text, chat, quote } = getMsgMeta(id, body, reply);

		const msg = await this.sock.sendMessage(chat, text, quote);

		return await getCtx(msg!, this);
	}

	// React: react on a msg
	async react(m: Msg, emoji: str) {
		const { chat, key } = m;

		return await this.send(chat, { react: { text: emoji, key } });
	}

	async editMsg(msg: Msg, text: str) {
		const { chat, key } = msg;

		return await this.sock.sendMessage(chat, { edit: key, text });
	}

	async deleteMsg(msgOrKey: Msg | proto.IMessageKey) {
		const { chat, key } = getMsgMeta(msgOrKey, '');

		return await this.send(chat, { delete: key });
	}

	// get a group cache or fetch it
	async getGroup(id: str): Promise<Group> {
		let group = this.groups.get(id);

		if (group) return group;
		else {
			// fetch group
			group = await this.sock.groupMetadata(id);
			const groupData = new Group(group);

			this.groups.add(groupData.id, await groupData.checkData());
			return groupData;
		}
	}

	async downloadMedia(msg: Msg) {
		const media = await downloadMediaMessage(msg.raw, 'buffer', {}, {
			logger: this.logger,
			reuploadRequest: this.sock.updateMediaMessage,
		})! as Buffer;

		return media || await this.sock.updateMediaMessage(msg.raw);
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

	async loadCmds(file: str, _category: str, imported: any) { // DENO point
		const cmd: Cmd = new imported();
		cmd.name = file.slice(0, -3);

		const properties: Cmd = Object.assign({
			name: '',
			aliases: [],
			cooldown: 3,
			run: cmd.run,
		}, cmd);
		// Compare cmd properties with a 'template base'
		// Fill missing data with default data

		// Set cmd
		this.cmds.set(properties.name!, properties);

		properties.aliases.forEach((a) => this.aliases.set(a, properties.name!));
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
			this.events.get(name)!(this, ...args, name)
				.catch((e: any) => console.error(`Events#${name}: ${e.stack}`));
			// eventFunction(this, ...args, name);
		});
	}
}
