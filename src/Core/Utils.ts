import type { Msg, MsgTypes } from '../Typings';
import { type proto } from 'baileys';
import type bot from './Bot';

export async function convertMsgData(raw: proto.IWebMessageInfo, bot?: bot) {
	const { message, key, pushName } = raw;

	const type = Object.keys(message!)[0] as MsgTypes;
	// msg type

	let group; // group metadata
	if (key.participant) group = await bot?.getGroup(key?.remoteJid!);

	return {
		id: key.id!, // msg id
		type,
		author: key.participant || key?.remoteJid!, // msg author id
		chat: key?.remoteJid!, // msg chat id
		username: pushName!, // msg author name
		group,
		text: getMsgText(message!, type).trim(),
		quoted: getQuoted(raw), // quoted msg
		raw, // raw msg obj
	} as Msg;
}

export function getQuoted(raw: proto.IWebMessageInfo) {
	const type = Object.keys(raw.message!)[0] as MsgTypes; // msg type
	const m = raw.message;

	//@ts-ignore quotedMsg is missing on lib types
	const quotedRaw = m![type]?.contextInfo?.quotedMessage || m?.extendedTextMessage.quotedMessage;

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

export async function cacheAllGroups(bot: bot) {
	const groupList = await bot.sock.groupFetchAllParticipating();

	Object.keys(groupList).forEach((g) => bot.groups.set(g, groupList[g]));
}

export function getMsgText(m: proto.IMessage, type: MsgTypes) {
	return String(
		//@ts-ignore
		m?.conversation || m![type]?.text || m[type]?.caption || m.extendedTextMessage.text ||
			'',
	);
}
