import {
	allMsgTypes,
	Cmd,
	type CmdCtx,
	coolValues,
	findKey,
	Group,
	isMedia,
	type Msg,
	type MsgTypes,
	User,
} from '../map.js'
import { type AnyMessageContent, downloadMediaMessage, type proto } from 'baileys'
import { getGroup, getUser } from '../plugin/prisma.js'
import cache from '../plugin/cache.js'
import { logger } from './proto.js'
import bot from '../wa.js'

// getCtx: command context === message abstraction layer
async function getCtx(raw: proto.IWebMessageInfo): Promise<CmdCtx> {
	const { message, key, pushName } = raw
	let fakeCtx = {} as CmdCtx

	// msg type
	const types = getMsgType(message!)
	if (!coolValues.includes(types[0])) return fakeCtx

	let group = undefined
	if (key.remoteJid?.includes('@g.us')) group = await getGroup(key.remoteJid)

	let phone = key.fromMe ? bot.sock.user?.id! : key.remoteJid!
	if (key.participant) phone = key.participant!

	if (phone.endsWith('@g.us')) return fakeCtx
	let user = await getUser({ phone })

	const mime = findKey(message, 'mimetype') // media mimetype like image/png
	const isBot = Boolean(key.fromMe && !Object.keys(key).includes('participant')) // if it's baileys client

	let msg: Msg = {
		chat: key?.remoteJid!, // msg chat id
		author: user?.phone!,
		type: types[0],
		text: getMsgText(message!),
		media: await downloadMedia(raw, types),
		quoted: await getQuoted(raw, group! || user), // quoted msg
		isBot,
		mime,
		isEdited: !!findKey(message, 'editedMessage'),
		key,
	}

	let args: str[] = []
	let cmd
	if (user) {
		if (pushName && pushName !== user.name) user.name = pushName
		const input = getInput(msg, user.prefix) // ignores non-prefixed msgs
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
		group,
	} as CmdCtx
}

// download msg media
async function downloadMedia(raw: any, types: [MsgTypes, str]) {
	const msg = (raw?.message || raw)[types[1]] || raw
	if (!isMedia(types[0]) || (!msg.media && !msg.url)) return

	let newObj: MediaMsg = {
		url: msg.url,
		directPath: msg.directPath,
		mediaKey: msg.mediaKey,
		thumbnailDirectPath: msg.thumbnailDirectPath,
	}

	if (cache.media.has(msg.url)) return newObj // return metadata to download it later
	const buffer = await downloadMediaMessage(
		raw.message ? raw : { message: raw },
		'buffer',
		{},
		{
			reuploadRequest: bot.sock.updateMediaMessage,
			logger,
		},
	)

	if (!buffer) return

	cache.media.add(msg.url, { // cache media
		buffer,
		url: msg.url,
		mime: msg.mimetype,
		length: msg.fileLength.low,
		duration: msg.seconds || 0, // for audio and video
		type: types[0],
		height: msg.height || 0,
		width: msg.width || 0,
	})

	return newObj
}

// getInput: get cmd, args and ignore non-prefixed msgs
function getInput(msg: Msg, prefix: str) {
	if (!msg.text.startsWith(prefix)) return { msg, args: [] } // does not returns cmd bc it does not exist

	let args: str[] = msg.text.replace(prefix, '').trim().split(' ')
	const callCmd = args.shift()!.toLowerCase() // cmd name on msg | .help => 'help' === callCmd
	const cmd = cache.cmds
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
async function getQuoted(raw: proto.IWebMessageInfo, chat: User | Group) {
	const m = raw.message!

	//@ts-ignore 'quotedMessage' is missing on lib types
	let quotedRaw: Partial<proto.IMessage | IFutureProofMessage> = findKey(m, 'quotedMessage')

	if (!quotedRaw) return
	const types = getMsgType(quotedRaw) // quoted message type
	if (Object.keys(quotedRaw)[0] === 'viewOnceMessageV2') quotedRaw = quotedRaw.viewOnceMessageV2!

	let quoted = {
		type: types[0], // msg type
		media: await downloadMedia(quotedRaw, types),
		//@ts-ignore
		text: getMsgText(quotedRaw),
		mime: findKey(quotedRaw, 'mimetype'),
	} as Msg

	let cachedMsg = chat.msgs.find((m) =>
		// compare quoted msg with cached msgs
		quoted?.type === m.type &&
		quoted?.media === m.media &&
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
function getMsgType(m: proto.IMessage): [MsgTypes, str] {
	for (const [rawType, newType] of Object.entries(allMsgTypes)) {
		const res = findKey(m, rawType)
		if (res) return [newType, rawType] as [MsgTypes, str] // ['image', 'imageMessage']
	}

	return ['event', Object.keys(m!)[0]] // return raw type
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
	// const quote = reply ? { quoted: reply } : typeof msg === 'string' ? {} : { quoted: msg?.raw }
	// @ts-ignore
	const key = msg?.key ? msg.key : msg

	if (!chat.includes('@')) chat += '@s.whatsapp.net'

	return { key, text, chat, quote: {} }
}

export { downloadMedia, getCtx, msgMeta }
