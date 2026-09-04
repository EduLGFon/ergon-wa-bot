import { type AnyMessageContent, downloadMediaMessage, type proto } from 'baileys'
import { findCachedOriginal, savePendingQuote } from '@plugin/deletedStore.ts'
import { type CmdCtx, type Msg, type MsgTypes } from '@conf/types/types.d.ts'
import { allMsgTypes, coolValues, isMedia } from '@conf/types/msgs.ts'
import { msgs, users } from '@conf/schema.ts'
import { findKey } from '@util/functions.ts'
import { db, getGroup, getUser } from '@db'
import { logger } from '@util/proto.ts'
import { eq, sql } from 'drizzle-orm'
import cache from '@plugin/cache.ts'
import User from '@class/user.ts'
import bot from '@plugin/bot.ts'
import Cmd from '@class/cmd.ts'

// getCtx: command context === message abstraction layer
async function getCtx(raw: proto.IWebMessageInfo): Promise<CmdCtx> {
	const { message, key, pushName } = raw
	const fakeCtx = {} as CmdCtx
	if (!key) {
		print('CTX', 'msg without key', raw, 'red')
		return fakeCtx
	}

	// msg type
	const types = getMsgType(message!)
	if (!coolValues.includes(types[0])) return fakeCtx

	let group = undefined
	if (key.remoteJid?.includes('@g.us')) group = await getGroup(key.remoteJid)

	let lid = key?.participant
	if (!lid) lid = key.fromMe ? bot.lid : key.remoteJid!

	if (lid?.endsWith('@g.us')) return fakeCtx
	const user = await getUser({ lid })

	const mime = findKey(message, 'mimetype') // media mimetype like image/png
	const isBot = Boolean(key.fromMe && !Object.prototype.hasOwnProperty.call(key, 'participant')) // if it's baileys client

	const msg: Msg = {
		chat: key?.remoteJid!, // msg chat id
		author: user?.id!,
		type: types[0],
		text: getMsgText(message!),
		media: await downloadMedia(raw, types),
		quoted: await getQuoted(raw), // quoted msg
		isBot,
		mime,
		isEdited: !!findKey(message, 'editedMessage'),
		key,
		message,
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

async function checkMatch(key: proto.IMessageKey) {
	const member = key?.participant
	const memberAlt = (key as any)?.participantAlt

	if (member?.includes('@lid') && memberAlt?.includes('@s.whatsapp.net')) {
		const oldUser = (await db?.select().from(users).where(eq(users.lid, memberAlt)))?.[0]
		if (!oldUser) return
		const newUser = (await db?.select().from(users).where(eq(users.lid, member)))?.[0]
		if (!newUser) return

		const oldMsgs = (await db?.select().from(msgs).where(eq(msgs.author, oldUser.id))) || []
		const newMsgs = (await db?.select().from(msgs).where(eq(msgs.author, newUser.id))) || []
		print(
			'MATCH',
			`User (${member}|${memberAlt} / ${oldUser.id}|${newUser.id}) has two entries.`,
			'blue',
		)
		print(oldUser, newUser)
		print(oldMsgs, newMsgs)

		const author = oldUser.id
		for (const m of newMsgs) {
			const group = m.group
			await db?.insert(msgs).values({ author, group, count: m.count }).onConflictDoUpdate({
				target: [msgs.author, msgs.group],
				set: { count: sql`${msgs.count} + ${m.count}` },
			})
		}
		await db?.delete(msgs).where(eq(msgs.author, newUser.id))
		await db?.update(users).set({ lid: newUser.lid }).where(eq(users.id, oldUser.id))
		await db?.delete(users).where(eq(users.id, newUser.id))
	}
}

// Future-proof wrappers (ephemeral, view-once, etc.) nesting the real content.
// Mirrors the unwrap list of Baileys normalizeMessageContent, which
// downloadMediaMessage already applies internally - but we need the inner
// media node ourselves for cache metadata (url, mimetype, ...).
const wrapperKeys = [
	'ephemeralMessage',
	'viewOnceMessage',
	'viewOnceMessageV2',
	'viewOnceMessageV2Extension',
	'documentWithCaptionMessage',
	'editedMessage',
	'associatedChildMessage',
	'groupStatusMessage',
	'groupStatusMessageV2',
]

// unwrapContent: strip wrapper layers to reach the real message content.
function unwrapContent(content: any): any {
	for (let i = 0; i < 5; i++) {
		const inner = wrapperKeys.map((k) => content?.[k]).find(Boolean)?.message
		if (!inner) break
		content = inner
	}
	return content
}

// findMediaNode: locate the inner node holding url/mediaKey, skipping
// quotedMessage like findKey does to avoid grabbing quoted media.
function findMediaNode(content: any): any {
	if (!content || typeof content !== 'object') return undefined
	if (content.url || content.mediaKey) return content

	for (const key of Object.getOwnPropertyNames(content)) {
		if (key === 'quotedMessage') continue
		const hit = findMediaNode(content[key])
		if (hit) return hit
	}
	return undefined
}

// download msg media
async function downloadMedia(raw: any, types: [MsgTypes, str]) {
	if (!isMedia(types[0])) return
	const inner = unwrapContent(raw?.message || raw)
	const direct = (inner as any)?.[types[1]]
	const msg = direct && typeof direct === 'object' && (direct.url || direct.mediaKey)
		? direct
		: findMediaNode(inner)
	if (!msg?.url) return

	const keyObj: MediaMsg = {
		url: msg.url,
		directPath: msg.directPath,
		mediaKey: msg.mediaKey,
		thumbnailDirectPath: msg.thumbnailDirectPath,
	}

	if (cache.media.has(msg.url)) return keyObj // return metadata to reuse it later
	const buffer = await downloadMediaMessage(
		raw.message ? raw : { message: raw },
		'buffer',
		{},
		{
			reuploadRequest: bot.sock.updateMediaMessage,
			logger,
		},
	).catch((_e) => {}) //print('DOWNLOAD', 'Error downloading media', e.stack, 'red')})

	if (!buffer) return

	// media cache
	cache.media.add(msg.url, {
		buffer,
		url: msg.url,
		mime: msg.mimetype,
		length: msg.fileLength?.low,
		duration: msg.seconds || 0, // for audio and video
		type: types[0],
		height: msg.height || 0,
		width: msg.width || 0,
	})

	return keyObj
}

// getInput: get cmd, args and ignore non-prefixed msgs
function getInput(msg: Msg, prefix: str) {
	if (!msg.text.startsWith(prefix)) return { msg, args: [] } // does not returns cmd bc it does not exist

	let args: str[] = msg.text.replace(prefix, '').trim().split(' ')
	const callCmd = args.shift()!.toLowerCase() // cmd name on msg | .help => 'help' === callCmd
	const cmd = cache.cmds.find((c) => c.name === callCmd || c.alias.includes(callCmd))
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

	return { msg, args, cmd }
}

// getQuoted: get the quoted msg of a raw msg
async function getQuoted(raw: proto.IWebMessageInfo) {
	const m = raw.message!

	const quotedOrig: any = findKey(m, 'quotedMessage')

	if (!quotedOrig) return
	if (Deno.env.get('SHOW_IDS')) {
		const stanza = findKey(m, 'contextInfo')?.stanzaId || 'no-stanza'
		print('QUOTED/shape', `${stanza} keys=${Object.keys(quotedOrig).join(',')}`, 'blue')
	}
	let quotedRaw: any = quotedOrig
	const types = getMsgType(quotedRaw) // quoted message type
	if (Object.keys(quotedRaw)[0] === 'viewOnceMessageV2') quotedRaw = quotedRaw.viewOnceMessageV2!

	const quoted = {
		type: types[0], // msg type
		media: await downloadMedia(quotedRaw, types),
		text: getMsgText(quotedRaw as proto.IMessage),
		mime: findKey(quotedRaw, 'mimetype'),
	} as Msg

	if (isMedia(types[0]) || quoted.text) {
		// The quote may reference an original the bot never cached (sent
		// before bot start, evicted). Stash a speculative copy keyed by the
		// stanzaId; it stays hidden until a revoke for it arrives. Real
		// view-once quotes arrive normalized (plain imageMessage), so no
		// wrapper sniffing here - the stanzaId correlation is what matters.
		await rescueOrphanQuote(raw, quotedOrig, quoted, types).catch((e) =>
			print('GOTCHA/quote', (e as Error)?.message || e, 'red')
		)
	}

	return quoted
}

// rescueOrphanQuote: stash a speculative disk copy of a quoted message when
// its original is not cached. The quote's stanzaId is the original id, so a
// later revoke either finds the live original (this stash is skipped) or
// promotes this copy (rescue). The original sender comes from participant.
async function rescueOrphanQuote(
	raw: proto.IWebMessageInfo,
	quotedOrig: any,
	quoted: Msg,
	types: [MsgTypes, str],
) {
	const ctxInfo = findKey(raw.message, 'contextInfo')
	const stanzaId = ctxInfo?.stanzaId as str | undefined
	const participant = ctxInfo?.participant as str | undefined
	if (!stanzaId) {
		print('GOTCHA', 'quote without stanzaId, skipped', 'yellow')
		return
	}

	const chat = ctxInfo?.remoteJid || raw.key?.remoteJid!
	if (findCachedOriginal(chat, stanzaId)) return // revoke path owns it

	// Media keys: prefer the downloaded result, else rebuild from the inner
	// node (the download may have failed, but keys persist for a later retry).
	let media = quoted.media
	if (!media?.url) {
		const node = findMediaNode(unwrapContent(quotedOrig))
		if (node?.url) {
			media = {
				url: node.url,
				directPath: node.directPath,
				mediaKey: node.mediaKey,
				thumbnailDirectPath: node.thumbnailDirectPath,
			}
		}
	}
	if (!quoted.text && !media?.url) return // nothing worth stashing

	const authorUser = participant ? await getUser({ lid: participant }).catch(() => null) : null

	await savePendingQuote({
		chat,
		id: stanzaId,
		author: authorUser?.id ?? 0,
		authorName: authorUser?.name || authorUser?.phone || 'user',
		type: types[0],
		text: quoted.text || '',
		mime: quoted.mime || '',
		media,
	})
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
	let chat = typeof msg === 'string'
		? msg
		: (msg as Msg).chat || (msg as proto.IMessageKey).remoteJid
	const text = typeof body === 'string' ? { text: body } : body
	const quote = reply
		? { quoted: reply }
		: typeof msg === 'string'
		? {}
		: { quoted: (msg as Msg).message }
	const key = (msg as Msg).key ? (msg as Msg).key : msg as proto.IMessageKey

	if (chat && !chat.includes('@')) chat += '@s.whatsapp.net'

	return { key, text, chat, quote }
}

export { checkMatch, downloadMedia, getCtx, msgMeta }
