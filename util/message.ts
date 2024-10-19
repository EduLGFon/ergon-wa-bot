import {
	allMsgTypes,
	Baileys,
	Cmd,
	CmdCtx,
	findKey,
	Group,
	isMedia,
	Msg,
	MsgTypes,
	User,
} from '../map.js'
import type { AnyMessageContent, proto } from 'baileys'

// message abstraction layer/command context
async function getCtx(raw: proto.IWebMessageInfo, bot: Baileys) {
	const { message, key, pushName } = raw

	// msg type
	const type = getMsgType(message!)

	let userID = key.fromMe ? bot.sock.user?.id : key.remoteJid

	let group: Group

	if (key.participant) {
		userID = key.participant

		if (key.remoteJid) {
			group = await bot.getGroup(key.remoteJid)
		}
	}

	const user: User = bot.users.add(userID!, {}, [pushName!])
	await user.checkData()

	let msg: Msg = {
		key,
		chat: key?.remoteJid!, // msg chat id
		type,
		text: getMsgText(message!),
		edited: Object.keys(message!)[0] === 'editedMessage', // if the msg is edited
		isBot: Boolean(key.fromMe && !key.participant),
		isMedia: isMedia(type),
		mime: findKey(message, 'mimetype'),
		quoted: getQuoted(raw)!, // quoted msg
		raw, // raw msg obj
	}
	
	const input = getInput(msg, bot, user.prefix)
	msg.text = input.msg.text

	return {
		msg,
		args: input.args,
		cmd: input.cmd,
		user,
		group: group!,
	} as CmdCtx
}

// getInput: get cmd, args and ignore non-prefixed msgs
function getInput(msg: Msg, bot: Baileys, prefix: str) {
	if (!msg.text.startsWith(prefix)) return {msg, args: []}

	let args: str[] = msg.text.replace(prefix, '').trim().split(' ')
	const callCmd = args.shift()?.toLowerCase()
	const cmd: Cmd | undefined = bot.cmds.get(callCmd) || bot.cmds.get(bot.aliases.get(callCmd)!)
	// search command by name or by aliases

	const first = args[0]?.toLowerCase()
	let text = msg?.quoted?.text

	if ((!first || (cmd?.subCmds?.includes(first) && !args[1]) ) && text) {
		const regex = /\.( |)[a-z]*( |)/gi
		
		if (text.match(regex)) text = text.replace(regex, '')
		if (cmd?.subCmds?.includes(first)) text = `${first} ${text}`
		
		args = text.split(' ')
		msg.text = text
	}

	return {
		msg,
		args,
		cmd
	}
}

// getQuoted: get the quoted msg of a raw msg
function getQuoted(raw: proto.IWebMessageInfo) {
	const m = raw.message!

	//@ts-ignore 'quotedMessage' is missing on lib types
	const quotedRaw: Partial<proto.IMessage> = findKey(m, 'quotedMessage')

	if (!quotedRaw) return

	const type = getMsgType(quotedRaw) // quoted message type

	return {
		type, // msg type
		isMedia: isMedia(type),
		//@ts-ignore
		text: getMsgText(quotedRaw),
		mime: findKey(quotedRaw, 'mimetype'),
		raw: { message: quotedRaw }, // raw quote obj
	} as Msg
}

// getMsgText: "get msg text"
function getMsgText(m: proto.IMessage) {
	for (const key of ['conversation', 'text', 'caption']) {
		const res = findKey(m, key)
		if (res) return String(res).trim()
	}

	return ''
}

// getMsgType: Get the type of a raw message
function getMsgType(m: proto.IMessage): MsgTypes {
	for (const [rawType, newType] of Object.entries(allMsgTypes)) {
		const res = findKey(m, rawType)

		if (res) return String(newType).trim() as MsgTypes
	}

	print('Unknown msg tyṕe:', m)
	return Object.keys(m!)[0] as MsgTypes
}

// msgMeta: get some meta data from a msg
function msgMeta(
	msg: str | Msg | proto.IMessageKey,
	body: str | AnyMessageContent,
	reply?: proto.IWebMessageInfo,
) {
	// @ts-ignore
	let chat = typeof msg === 'string' ? msg : msg.chat || msg.remoteJid
	const text = typeof body === 'string' ? { text: body } : body
	// @ts-ignore
	const quote = reply ? { quoted: reply } : typeof msg === 'string' ? {} : { quoted: msg?.raw }
	// @ts-ignore
	const key = msg?.key ? msg.key : msg

	if (!chat.includes('@')) chat += '@s.whatsapp.net'

	return { key, text, chat, quote }
}

function checkPermissions(cmd: Cmd, user: User, group?: Group) {
    const devs = process.env.DEVS!
    if (cmd.access.onlyDevs && !devs.includes(user.id)) return 'block'
    if (!cmd.access.groups && group) return 'x'
    if (!cmd.access.dm && !group) return 'x'

    return true
}

export {
	getCtx,
	getMsgText,
	getMsgType,
	getQuoted,
    checkPermissions,
	msgMeta,
}
