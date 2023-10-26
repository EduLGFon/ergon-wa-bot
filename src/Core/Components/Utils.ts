import type { CmdContext, Msg, MsgTypes } from '../Typings/types.js';
import config from '../JSON/config.json' assert { type: 'json' };
import { isMedia, msgTypes } from '../Typings/MsgTypes.js';
import { readdirSync, unlink } from 'node:fs';
import Group from '../Classes/Group.js';
import User from '../Classes/User.js';
import { type proto } from 'baileys';
import Bot from '../Classes/Bot.js';
import prisma from './Prisma.js';

export async function getCtx(raw: proto.IWebMessageInfo, bot: Bot) {
	const { message, key, pushName } = raw;

	const type = getMsgType(message!);
	// msg type
	const userID = key.participant || key?.remoteJid!;

	let group: Group; // group metadata
	if (key.participant && key.remoteJid) group = await bot.getGroup(key.remoteJid);

	let user = bot.users.get(userID);
	if (!user) {
		user = await new User(userID, pushName!).checkData();
		bot.users.set(userID, user);
	}

	return {
		prisma,
		msg: {
			id: key.id!, // msg id
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

export async function delay(time: num) {
	return await new Promise((r) => setTimeout(() => r(true), time));
}

export async function cacheAllGroups(bot: Bot) {
	const groupList = await bot.sock.groupFetchAllParticipating();

	let groups = Object.keys(groupList);

	groups.forEach(async (g) => {
		const group = new Group(groupList[g]);

		bot.groups.set(group.id, await group.checkData());
	});

	console.log('CACHE', `${groups.length} groups cached.`, 'blue');
	return;
}

export function isEmpty(value: unknown): boolean { // check if a array/obj is empty
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

export function getQuoted(raw: proto.IWebMessageInfo) {
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

function getMsgText(m: proto.IMessage) {
	for (const key of ['conversation', 'text', 'caption']) {
		const res = findKey(m, key);
		if (res) return String(res).trim();
	}

	return '';
}

function getMsgType(m: proto.IMessage): MsgTypes {
	for (const [rawType, newType] of Object.entries(msgTypes)) {
		const res = findKey(m, rawType);

		if (res) return String(newType).trim() as MsgTypes;
	}

	return Object.keys(m!)[0] as MsgTypes;
}

export function getStickerAuthor(user: User, group?: Group) {
	return {
		pack: config.PACK.join('\n'),

		author: config.AUTHOR.join('\n')
			.replace('{username}', user.name)
			.replace('{link}', config.LINK)
			.replace('{group}', group?.name || 'Not a group'),
	};
}

export function findKey(obj: any, key: str): any {
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

export async function clearTemp() {
	// clear temp folder
	const files = readdirSync('./temp/');

	files.forEach((f) => unlink(`./temp/${f}`, () => {}));
	return;
}
