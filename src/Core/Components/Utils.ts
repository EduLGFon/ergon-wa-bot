import type { CmdContext, Msg, MsgTypes } from '../Typings/types.js';
import { existsSync, mkdirSync, readdirSync, unlink } from 'node:fs';
import config from '../JSON/config.json' assert { type: 'json' };
import { isMedia, msgTypes } from '../Typings/MsgTypes.js';
import type { AnyMessageContent, proto } from 'baileys';
import Group from '../Classes/Group.js';
import User from '../Classes/User.js';
import Bot from '../Classes/Bot.js';

// message abstraction layer/command context
async function getCtx(raw: proto.IWebMessageInfo, bot: Bot) {
	const { message, key, pushName } = raw;

	// msg type
	const type = getMsgType(message!);

	let userID = key.fromMe ? bot.sock.user?.id : key.remoteJid;

	let group: Group;

	if (key.participant) {
		userID = key.participant;

		if (key.remoteJid) {
			group = await bot.getGroup(key.remoteJid);
		}
	}

	let user: User = bot.users.get(userID);

	if (!user) {
		user = await new User(userID!, pushName!).checkData();
		bot.users.add(user.id, user);
	}

	return {
		msg: {
			key,
			chat: key?.remoteJid!, // msg chat id
			edited: Object.keys(message!)[0] === 'editedMessage', // if the msg is edited
			text: getMsgText(message!),
			type,
			isMedia: isMedia(type),
			quoted: getQuoted(raw), // quoted msg
			raw, // raw msg obj
		},
		user,
		group: group!,
		bot,
	} as CmdContext;
}

// Delay: make the code wait for some time
async function delay(time: num) {
	return await new Promise((r) => setTimeout(() => r(true), time));
}

// cacheAllGroups: 'cache all groups'
async function cacheAllGroups(bot: Bot) {
	const groupList = await bot.sock.groupFetchAllParticipating();

	let groups = Object.keys(groupList);

	groups.forEach(async (g) => {
		const group = new Group(groupList[g]);

		bot.groups.add(group.id, await group.checkData());
	});

	console.log('CACHE', `${groups.length} groups cached.`, 'blue');
	return;
}

// getQuoted: get the quoted msg of a raw msg
function getQuoted(raw: proto.IWebMessageInfo) {
	const m = raw.message!;

	//@ts-ignore 'quotedMessage' is missing on lib types
	const quotedRaw = findKey(m, 'quotedMessage');

	if (!quotedRaw) return;

	const type = getMsgType(quotedRaw); // quoted message type

	return {
		type, // msg type
		isMedia: isMedia(type),
		//@ts-ignore
		text: getMsgText(quotedRaw),
		raw: { message: quotedRaw }, // raw quote obj
	} as Partial<Msg>;
}

// getMsgText: "get msg text"
function getMsgText(m: proto.IMessage) {
	for (const key of ['conversation', 'text', 'caption']) {
		const res = findKey(m, key);
		if (res) return String(res).trim();
	}

	return '';
}

// getMsgType: Get the type of a raw message
function getMsgType(m: proto.IMessage): MsgTypes {
	for (const [rawType, newType] of Object.entries(msgTypes)) {
		const res = findKey(m, rawType);

		if (res) return String(newType).trim() as MsgTypes;
	}

	return Object.keys(m!)[0] as MsgTypes;
}
// genStickerMeta: Generate the author/pack for a sticker
function genStickerMeta(user: User, group?: Group) {
	return {
		pack: config.PACK.join('\n'),

		author: config.AUTHOR.join('\n')
			.replace('{username}', user.name)
			.replace('{link}', config.LINK)
			.replace('{group}', group?.name || 'Not a group'),
	};
}

// findKey: Search for a key inside an object
function findKey(obj: any, key: str): any {
	// if the obj has this key, return it
	if (obj.hasOwnProperty(key)) return obj[key];

	// search the key on all objs inside the main obj
	for (const property of Object.getOwnPropertyNames(obj)) {
		// without this, the msg type could be the quoted msg type.
		if (property === 'quotedMessage' && key !== 'quotedMessage') continue;

		// if the property is a obj, call findKey() recursively
		if (typeof obj[property] === 'object') {
			const result = findKey(obj[property], key);

			if (result !== undefined) return result;
		}

		// If it's a method, check if it is the searched value
		if (typeof obj[property] === 'function' && property === key) return obj[property];
	}

	return;
}

// Validate whether a variable actually has a useful value
function isEmpty(value: unknown): bool { // check if a array/obj is empty
	if (!value) return true;

	if (Array.isArray(value)) {
		return value.length === 0 ||
			value.some((item) => item === undefined || isEmpty(item));
	} else if (typeof value === 'object') {
		return Object.keys(value!).length === 0;
		//|| Object.values(value!).some((item) => item === undefined || isEmpty(item));
	}

	return true;
}

// isValidPositiveIntenger: validate a number
function isValidPositiveIntenger(value: num): bool {
	return !Number.isNaN(value) && value > 0 && Number.isInteger(value);
}

// getMsgMeta: get some meta data from a msg
function getMsgMeta(
	msg: str | Msg | proto.IMessageKey,
	body: str | AnyMessageContent,
	reply?: proto.IWebMessageInfo,
) {
	// @ts-ignore
	let chat = typeof msg === 'string' ? msg : msg.chat || msg.remoteJid;
	const text = typeof body === 'string' ? { text: body } : body;
	// @ts-ignore
	const quote = reply ? { quoted: reply } : typeof msg === 'string' ? {} : { quoted: msg?.raw };
	// @ts-ignore
	const key = msg?.key ? msg.key : msg;

	if (!chat.includes('@')) chat += '@s.whatsapp.net';

	return { key, text, chat, quote };
}

// cleanTemp: Clean temp folder
async function cleanTemp() {
	if (!existsSync('./temp/')) mkdirSync('./temp');

	const files = readdirSync('./temp');

	files.forEach((f) => unlink(`./temp/${f}`, () => {}));

	return;
}

export {
	cacheAllGroups,
	cleanTemp,
	delay,
	findKey,
	genStickerMeta,
	getCtx,
	getMsgMeta,
	getMsgText,
	getMsgType,
	getQuoted,
	isEmpty,
	isValidPositiveIntenger,
};
