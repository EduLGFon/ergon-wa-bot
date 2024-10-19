import type { CmdContext, Msg, MsgTypes } from '../Typings/index';
import { AUTHOR, LINK, PACK } from '../../JSON/config.json';
import { isMedia, msgTypes } from '../Plugins/MsgTypes';
import { GroupMetadata, type proto } from 'baileys';
import User from '../Classes/User';
import Bot from '../Classes/Bot';
import prisma from './Prisma';

export async function getCtx(raw: proto.IWebMessageInfo, bot: Bot) {
	const { message, key, pushName } = raw;

	const type = getMsgType(message!);
	// msg type
	const userID = key.participant || key?.remoteJid!;

	let group; // group metadata
	if (key.participant) group = await bot.getGroup(key?.remoteJid!);

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
			author: pushName!, // msg author name
			text: getMsgText(message!),
			type,
			isMedia: isMedia(type),
			quoted: getQuoted(raw), // quoted msg
			raw, // raw msg obj
		},
		user,
		group,
		bot,
	} as CmdContext;
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

export async function cacheAllGroups(bot: Bot) {
	const groupList = await bot.sock.groupFetchAllParticipating();

	Object.keys(groupList).forEach((g) => bot.groups.set(g, groupList[g]));
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

export function getStickerAuthor(msg: Msg, group: GroupMetadata) {
	return {
		pack: PACK.join(''),

		author: AUTHOR.join('')
			.replace('{username}', msg?.author)
			.replace('{link}', LINK)
			.replace('{group}', group?.subject || 'Not a group'),
	};
}

export function findKey(obj: any, key: string): any {
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
