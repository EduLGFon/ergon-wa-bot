import type { CmdContext, Msg, MsgTypes } from '../Typings';
import { type proto } from 'baileys';
import prisma from './Prisma';
import User from './User';
import Bot from './Bot';

export async function getCtx(raw: proto.IWebMessageInfo, bot: Bot) {
	const { message, key, pushName } = raw;

	const type = Object.keys(message!)[0] as MsgTypes;
	// msg type
	const userID = key.participant || key?.remoteJid!;

	let group; // group metadata
	if (key.participant) group = await bot.getGroup(key?.remoteJid!);

	let user = bot.users.get(userID);
	if (!user) {
		user = new User(userID);
		bot.users.set(userID, user);
	}

	return {
		prisma,
		msg: {
			id: key.id!, // msg id
			chat: key?.remoteJid!, // msg chat id
			author: pushName!, // msg author name
			text: getMsgText(message!, type).trim(),
			type, // msg type
			quoted: getQuoted(raw), // quoted msg
			raw, // raw msg obj
		},
		user,
		group,
		bot,
	} as CmdContext;
}

export function getQuoted(raw: proto.IWebMessageInfo) {
	const type = Object.keys(raw.message!)[0] as MsgTypes; // msg type
	const m = raw.message;

	//@ts-ignore quotedMsg is missing on lib types
	const quotedRaw = m![type]?.contextInfo?.quotedMessage ||
		m?.extendedTextMessage?.contextInfo?.quotedMessage;

	if (!quotedRaw) return;

	const quotedType = Object.keys(quotedRaw!)[0] as MsgTypes; // quoted msg type

	// the real quoted message
	const msg = quotedRaw[quotedType] as proto.Message.IImageMessage;

	return {
		type: quotedType, // msg type
		//@ts-ignore
		text: String(quotedRaw?.conversation || msg?.text || msg?.caption || '')?.trim(),
		raw: { message: quotedRaw }, // raw quote obj
	} as Partial<Msg>;
}

export async function cacheAllGroups(bot: Bot) {
	const groupList = await bot.sock.groupFetchAllParticipating();

	Object.keys(groupList).forEach((g) => bot.groups.set(g, groupList[g]));
}

export function getMsgText(m: proto.IMessage, type: MsgTypes) {
	return String(
		//@ts-ignore
		m?.conversation || m[type]?.text || m[type]?.caption || m?.extendedTextMessage?.text ||
			'',
	);
}
