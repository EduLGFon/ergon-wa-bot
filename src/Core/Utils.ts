import type { Msg, MsgTypes } from '../Typings';
import { type proto } from 'baileys';
import type bot from './Bot';

export async function convertMsgData(raw: proto.IWebMessageInfo, bot?: bot) {
	const { message, key, pushName } = raw;

	const type = Object.keys(message!)[0] as MsgTypes;
	// tipo da msg

	let group; // metadados do grupo, se a msg for de um grupo
	if (key.participant) group = await bot?.getGroup(key.remoteJid!);

	return {
		id: key.id!, // id da msg
		type, // tipo da msg
		author: key.participant || key.remoteJid!, // id do autor da msg
		chat: key.remoteJid!, // id do chat da msg
		username: pushName!, // nome do autor da msg
		group,
		//@ts-ignore
		text: String(message.conversation || message[type]?.text || message[type]?.caption).trim(),
		quoted: getQuoted(raw),
		raw, // obj bruto recebido
	} as Msg;
}

export function getQuoted(raw: proto.IWebMessageInfo) {
	const type = Object.keys(raw.message!)[0] as MsgTypes;

	//@ts-ignore a propriedade quotedMessage está faltando
	// nos tipos da biblioteca
	const quotedRaw = raw.message![type]?.contextInfo?.quotedMessage;

	if (!quotedRaw) return;

	const quotedType = Object.keys(quotedRaw!)[0] as MsgTypes;

	const quotedMsg = quotedRaw[quotedType] as proto.Message.IImageMessage;

	return {
		// id: quotedMsg,
		type: quotedType, // tipo da msg
		// author: quotedMsg., // id do autor da msg
		// chat: quotedMsg., // id do chat da msg
		// username: quotedMsg, // nome do autor da msg
		// group,
		//@ts-ignore
		text: String(quotedMsg.conversation || quotedMsg?.text || quotedMsg?.caption).trim(),
		raw: { message: quotedRaw }, // obj bruto
	} as Partial<Msg>;
}

export async function cacheAllGroups(bot: bot) {
	const groupList = await bot.sock.groupFetchAllParticipating();

	Object.keys(groupList).forEach((g) => bot.groups.set(g, groupList[g]));
}
