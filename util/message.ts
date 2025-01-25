import {
	allMsgTypes,
	Baileys,
	Cmd,
	CmdCtx,
	coolValues,
	findKey,
	Group,
	isMedia,
	Msg,
	MsgTypes,
	User,
} from '../map.js'
import type { AnyMessageContent, proto } from 'baileys'

// getCtx: command context === message abstraction layer
async function getCtx(raw: proto.IWebMessageInfo, bot: Baileys): Promise<CmdCtx> {
	const { message, key, pushName } = raw

	let fakeCtx = {} as CmdCtx

	// msg type
	const type = getMsgType(message!)
	if (!coolValues.includes(type)) return fakeCtx

	let group: Group
	if (key.remoteJid?.includes('@g.us')) group = await bot.getGroup(key.remoteJid)

	let phone = key.fromMe ? bot.sock.user?.id! : key.remoteJid!
	if (key.participant) phone = key.participant!

	if (phone.endsWith('@g.us')) return fakeCtx
	let user = await bot.getUser({ phone })

	let msg: Msg = {
		key,
		chat: key?.remoteJid!, // msg chat id
		type,
		text: getMsgText(message!),
		edited: Object.keys(message!)[0] === 'editedMessage', // if the msg is edited
		isBot: Boolean(key.fromMe && !Object.keys(key).includes('participant')), // if it's baileys client,
		isMedia: isMedia(type), // is video, photo or audio msg
		mime: findKey(message, 'mimetype'), // media mimetype like image/png
		quoted: getQuoted(raw, group! || user)!, // quoted msg
		raw, // raw msg obj
	}

	let args: str[] = []
	let cmd
	if (user) {
		if (pushName && pushName !== user.name) user.name = pushName
		const input = getInput(msg, bot, user.prefix) // ignores non-prefixed msgs
		msg.text = input.msg.text // it may change msg.text by msg.quoted.text
		// so when someone asks something
		// you can reply it with `.g` and search it
		args = input.args
		cmd = input.cmd
	}

	return {
		msg,
		args,
		cmd: cmd as Cmd,
		user: user as User,
		group: group!,
	} as CmdCtx
}

// getInput: get cmd, args and ignore non-prefixed msgs
function getInput(msg: Msg, bot: Baileys, prefix: str) {
	if (!msg.text.startsWith(prefix)) return { msg, args: [] } // does not returns cmd bc it does not exist

	let args: str[] = msg.text.replace(prefix, '').trim().split(' ')
	const callCmd = args.shift()!.toLowerCase() // cmd name on msg | .help => 'help' === callCmd
	const cmd = bot.cache.cmds
		.find((c) => c.name === callCmd || c.alias.includes(callCmd))
	// search command by name or by aliases

	const first = args[0]?.toLowerCase() // first arg
	let text = msg?.quoted?.text

	if ((!first || (cmd?.subCmds?.includes(first) && !args[1])) && text) {
		const regex = /\.( |)[a-z]*( |)/gi
		// change msg.text by msg.quoted.text, so
		// someone: *stupid question*
		// you (smart guy): .g (mentioning that stupid msg)
		// gemini: the useless response that guy want

		if (text.match(regex)) text = text.replace(regex, '')
		if (cmd?.subCmds?.includes(first)) text = `${first} ${text}`

		args = text.split(' ')
		msg.text = text
	}

	return {
		msg,
		args,
		cmd,
	}
}

// getQuoted: get the quoted msg of a raw msg
function getQuoted(raw: proto.IWebMessageInfo, chat: User | Group) {
	const m = raw.message!

	//@ts-ignore 'quotedMessage' is missing on lib types
	const quotedRaw: Partial<proto.IMessage> = findKey(m, 'quotedMessage')

	if (!quotedRaw) return
	const type = getMsgType(quotedRaw) // quoted message type

	let quoted = {
		type, // msg type
		isMedia: isMedia(type),
		//@ts-ignore
		text: getMsgText(quotedRaw),
		mime: findKey(quotedRaw, 'mimetype'),
		raw: { message: quotedRaw }, // raw quote msg obj
	} as Msg

	let cachedMsg = chat.msgs.find((m) =>
		// compare quoted msg with cached msgs
		quoted?.type === m.type &&
		quoted?.isMedia === m.isMedia &&
		quoted?.text === m.text &&
		quoted?.mime === m.mime
	)

	return quoted || cachedMsg
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

	console.error(m, 'UMT') // When a Unknown Message Type appears
	// I analize and categorize it.

	return Object.keys(m!)[0] as MsgTypes // return raw type
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

// checkPermissions: check cmd permissions like block random guys from using eval
function checkPermissions(cmd: Cmd, user: User, group?: Group) {
	const isDev = process.env.DEVS!.includes(user.phone)
	// if a normal user tries to run a only-for-devs cmd
	if (cmd.access.restrict && !isDev) return 'prohibited'

	if (group) { // if msg chat is a group
		if (!cmd.access.groups) return 'block'

		const admins = group.members.map((m) => m.admin && m.id)
		// all group admins id

		if (cmd.access.admin && (!admins.includes(user.chat) && !isDev)) {
			return 'prohibited' // Devs can use admin cmds for security reasons
		}
	} else if (!cmd.access.dm) return 'block'
	// if there's no group and cmd can't run on DM

	if (cmd.access.needsDb && !process.env.DATABASE_URL) return 'nodb'

	return true
}

export { checkPermissions, getCtx, getMsgText, getMsgType, getQuoted, msgMeta }
