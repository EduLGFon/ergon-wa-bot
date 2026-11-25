// msgTools - message helpers for ctx, media and quotes
// - provides getCtx, downloadMedia and orphan quote rescue
import { findCachedOriginal, savePendingQuote } from '@plugin/deletedStore.ts'
import { type CmdCtx, type Msg, type MsgTypes } from '@conf/types/types.d.ts'
import { allMsgTypes, coolValues, isMedia } from '@conf/types/msgs.ts'
import { downloadMediaMessage, type proto } from 'baileys'
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
		print('CTX', 'msg without key', 'red')
		return fakeCtx
	}

	// msg type
	const types = getMsgType(message!)
	if (!coolValues.includes(types[0])) return fakeCtx

	let group = undefined
	if (key.remoteJid?.includes('@g.us')) group = await getGroup(key.remoteJid) ?? undefined

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
		// Lazily resolve only the media KEYS here - the buffer is fetched on
		// demand by getMedia(). Eagerly downloading every inbound media
		// message doubled the work with the bridge (which downloads its own
		// copy) and pinned up to 100 buffers (up to ~2 GB) in cache.media,
		// which was the main driver of the RSS creep seen in production.
		media: await downloadMedia(raw, types, false),
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
		// Avoid logging personal data (names/phones/memories); keep ids only.
		print('MATCH', `merged ${oldMsgs.length} msg rows into author ${oldUser.id}`, 'blue')

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
		// Keep in-memory caches in sync after the merge.
		cache.users.delete(newUser.id)
		cache.userByLid.delete(newUser.lid)
		try {
			cache.userByPhone.delete(newUser.lid.parsePhone())
		} catch {
			// best effort
		}
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

// View-once wrappers. WhatsApp's Nov 2026 change withholds the media key from
// web-class linked devices, so these may arrive with empty/stub content.
const viewOnceKeys = ['viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension']
const directMediaKeys = [
	'imageMessage',
	'videoMessage',
	'audioMessage',
	'stickerMessage',
	'documentMessage',
]

// hasMediaKey: true for a non-empty proto media key (Buffer/Uint8Array/string).
function hasMediaKey(key: unknown): bool {
	if (!key) return false
	if (typeof key === 'string') return key.length > 0
	if (Array.isArray(key)) return key.length > 0
	if (key instanceof ArrayBuffer) return key.byteLength > 0
	if (ArrayBuffer.isView(key)) return key.byteLength > 0
	return false
}

// hasUsableMediaKeys: a decrypt needs both a URL and a non-empty media key.
function hasUsableMediaKeys(node: any): bool {
	return !!node && typeof node === 'object' &&
		typeof node.url === 'string' && node.url.trim().length > 0 &&
		hasMediaKey(node.mediaKey)
}

// viewOnceInner: content inside a view-once wrapper, or undefined when the
// content is not view-once. Empty/stub wrappers return an empty object so the
// type falls through to event instead of the old hardcoded image.
function viewOnceInner(content: any): any | undefined {
	let cur = content
	let found = false
	for (let i = 0; i < 5 && cur && typeof cur === 'object'; i++) {
		const key = viewOnceKeys.find((k) => cur[k])
		if (key) {
			const wrapper = cur[key]
			if (!wrapper || typeof wrapper !== 'object') return undefined
			found = true
			cur = wrapper.message ?? wrapper
			continue
		}
		const inner = wrapperKeys.map((k) => cur[k]).find(Boolean)?.message
		if (!inner) break
		cur = inner
	}
	return found ? cur : undefined
}

// isViewOnceContent: true when content nests a view-once wrapper (even behind
// an ephemeral/edit layer) or keeps the media-level viewOnce flag.
function isViewOnceContent(content: any): bool {
	let cur = content
	for (let i = 0; i < 5 && cur && typeof cur === 'object'; i++) {
		if (viewOnceKeys.some((k) => cur[k])) return true
		const inner = wrapperKeys.map((k) => cur[k]).find(Boolean)?.message
		if (!inner) break
		cur = inner
	}
	return directMediaKeys.some((k) => cur?.[k]?.viewOnce === true)
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
// Memory note: buffers stay in cache.media (100 slots). Videos/documents
// are never cached in RAM - only their keys are returned - because a few
// 20MB videos exhaust the heap. Images/stickers/audio cap at 8MB cached.
const MEDIA_CACHE_MAX_BYTES = 20 * 1024 * 1024
const MEDIA_CACHE_IMAGE_MAX_BYTES = 8 * 1024 * 1024
const MSG_DL_ATTEMPTS = 2
const MSG_DL_RETRY_MS = 500
const MSG_DL_JITTER_MS = 250

// True for stale/expired media keys: OpenSSL rejects the decrypt
// deterministically (code ERR_OSSL_EVP_BAD_DECRYPT, message "bad decrypt").
// Retrying never helps, so these skip the retry below.
function isBadDecrypt(e: unknown): boolean {
	try {
		const rec = (e && typeof e === 'object' ? e : {}) as Record<string, unknown>
		const cause = rec.cause as Record<string, unknown> | undefined
		const text = [rec.code, rec.name, rec.message, cause?.code, cause?.message]
			.filter((p) => typeof p === 'string').join(' ').toLowerCase()
		return text.includes('bad_decrypt') || text.includes('bad decrypt')
	} catch {
		return false
	}
}

async function downloadMedia(
	raw: any,
	types: [MsgTypes, str],
	downloadBuffer = true,
	commandPath = false,
) {
	if (!isMedia(types[0])) return
	const inner = unwrapContent(raw?.message || raw)
	const direct = (inner as any)?.[types[1]]
	const msg = direct && typeof direct === 'object' && (direct.url || direct.mediaKey)
		? direct
		: findMediaNode(inner)
	// Empty view-once keys (WhatsApp Nov 2026 web-class behavior) and stub
	// nodes must never reach the decrypt path: it throws and retrying cannot
	// recover them.
	if (!hasUsableMediaKeys(msg)) return

	const keyObj: any = {
		url: msg.url,
		directPath: msg.directPath,
		mediaKey: msg.mediaKey,
		thumbnailDirectPath: msg.thumbnailDirectPath,
		mime: msg.mimetype,
		length: msg.fileLength?.low ?? msg.fileLength ?? 0,
		duration: msg.seconds || 0,
		height: msg.height || 0,
		width: msg.width || 0,
		type: types[0],
	}

	if (cache.media.has(msg.url)) {
		const cached = cache.media.get(msg.url)
		if (downloadBuffer && cached?.buffer) keyObj.buffer = cached.buffer
		return keyObj // return metadata to reuse it later
	}

	if (!downloadBuffer) {
		// Keys only: no network, no cache entry, no RAM. The bridge and
		// getMedia() fetch the bytes when (and if) they are actually used.
		return keyObj
	}

	// Large video/document: command paths bypass the 8MB RAM-cache guard via
	// streaming/temp-file handling below; non-command paths keep keys only.
	const isHeavy = types[0] === 'video' || types[0] === 'document'
	const declaredSize = Number(msg.fileLength?.low ?? msg.fileLength ?? 0)
	if (!commandPath && isHeavy && declaredSize > MEDIA_CACHE_IMAGE_MAX_BYTES) return keyObj
	const skipCache = declaredSize > MEDIA_CACHE_MAX_BYTES
	// Bounded retry for transient CDN failures (fetch failed) with backoff
	// plus jitter. Stale keys (bad decrypt) fail permanently - no retry.
	// URL refresh is attempted once on the first transient failure, mirroring
	// the bridge downloader, to recover expired CDN URLs.
	let buffer: Buffer | Uint8Array | null | undefined
	let dlErr: unknown = null
	let refreshedOnce = false
	let workingRaw: any = raw
	let workingInner: any = inner
	let workingMsg: any = msg
	for (let attempt = 1; attempt <= MSG_DL_ATTEMPTS; attempt++) {
		try {
			buffer = await downloadMediaMessage(
				{ ...(workingRaw as any), message: workingInner } as any,
				'buffer',
				{},
				{
					reuploadRequest: bot.sock.updateMediaMessage,
					logger,
				},
			) as Buffer | Uint8Array | null | undefined
		} catch (e) {
			dlErr = e
			if (isBadDecrypt(e)) break
			if (!refreshedOnce) {
				refreshedOnce = true
				try {
					const updated = await bot.sock.updateMediaMessage?.(workingRaw as any)
					if (updated) {
						workingRaw = updated
						const newInner = unwrapContent((updated as any)?.message || updated)
						const newDirect = newInner?.[types[1]]
						const newNode = newDirect && typeof newDirect === 'object' &&
								(newDirect.url || newDirect.mediaKey)
							? newDirect
							: findMediaNode(newInner)
						if (hasUsableMediaKeys(newNode)) {
							workingInner = newInner
							workingMsg = newNode
							keyObj.url = newNode.url
							keyObj.directPath = newNode.directPath
							keyObj.mediaKey = newNode.mediaKey
							keyObj.thumbnailDirectPath = newNode.thumbnailDirectPath
						}
					}
				} catch {
					// best effort refresh; retry anyway
				}
			}
		}
		if (buffer || attempt >= MSG_DL_ATTEMPTS || isBadDecrypt(dlErr)) break
		await new Promise((r) => setTimeout(r, MSG_DL_RETRY_MS + Math.random() * MSG_DL_JITTER_MS))
	}

	if (!buffer) {
		const errMsg = dlErr instanceof Error ? dlErr.message : String(dlErr ?? 'unknown')
		print('DOWNLOAD', 'media download failed:', errMsg.slice(0, 160), 'red')
		return keyObj
	}
	// Command paths may keep oversized buffers (temp-file/streaming) without
	// caching them; non-command paths discard oversized buffers.
	if (!commandPath) {
		if (skipCache || (buffer as Buffer).length > MEDIA_CACHE_MAX_BYTES) return keyObj
		// Heavy types stay out of RAM cache past 8MB even when declared small.
		if (isHeavy && (buffer as Buffer).length > MEDIA_CACHE_IMAGE_MAX_BYTES) return keyObj
	}

	// media cache (only when within caps)
	if (
		!skipCache &&
		(buffer as Buffer).length <= MEDIA_CACHE_MAX_BYTES &&
		!(isHeavy && (buffer as Buffer).length > MEDIA_CACHE_IMAGE_MAX_BYTES)
	) {
		cache.media.add(keyObj.url, {
			buffer,
			url: keyObj.url,
			mime: workingMsg.mimetype ?? msg.mimetype,
			length: workingMsg.fileLength?.low ?? msg.fileLength?.low,
			duration: workingMsg.seconds || msg.seconds || 0,
			type: types[0],
			height: workingMsg.height || msg.height || 0,
			width: workingMsg.width || msg.width || 0,
		})
	}

	keyObj.buffer = buffer
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
	const quotedRaw: any = unwrapContent(quotedOrig)
	const types = getMsgType(quotedRaw) // quoted message type
	const viewOnce = isViewOnceContent(quotedOrig)

	const ctxInfo = findKey(raw.message, 'contextInfo')
	const stanzaId = ctxInfo?.stanzaId as str | undefined
	const participant = ctxInfo?.participant as str | undefined
	const remoteJid = (ctxInfo?.remoteJid as str | undefined) || raw.key?.remoteJid!
	const quotedKey = stanzaId
		? ({ id: stanzaId, remoteJid, fromMe: false, participant } as proto.IMessageKey)
		: ({} as proto.IMessageKey)

	const quoted = {
		type: types[0], // msg type
		media: await downloadMedia(quotedRaw, types, false),
		text: getMsgText(quotedRaw as proto.IMessage),
		mime: findKey(quotedRaw, 'mimetype'),
		message: quotedRaw,
		key: quotedKey,
	} as Msg

	// View-once quote with no usable keys: WhatsApp withheld the content from
	// this linked device. Commands still try a cached original by stanzaId;
	// this flag only selects the specific localized failure message.
	if (viewOnce && !quoted.media) quoted.mediaUnavailable = 'view-once'

	if (isMedia(types[0]) || quoted.text) {
		// The quote may reference an original the bot never cached (sent
		// before bot start, evicted). Stash a speculative copy keyed by the
		// stanzaId; it stays hidden until a revoke for it arrives. View-once
		// quotes may arrive without usable keys, so only text/usable media is
		// stashed - the stanzaId correlation is what matters.
		await rescueOrphanQuote(raw, quotedOrig, quoted, types).catch(() => {})
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
	if (!stanzaId) return

	const chat = ctxInfo?.remoteJid || raw.key?.remoteJid!
	if (findCachedOriginal(chat, stanzaId)) return // revoke path owns it

	// Media keys: prefer the downloaded result, else rebuild from the inner
	// node (the download may have failed, but keys persist for a later retry).
	// Empty view-once keys are useless, so do not stash a URL-only entry.
	let media = quoted.media
	if (!hasUsableMediaKeys(media)) {
		const node = findMediaNode(unwrapContent(quotedOrig))
		media = hasUsableMediaKeys(node)
			? {
				url: node.url,
				directPath: node.directPath,
				mediaKey: node.mediaKey,
				thumbnailDirectPath: node.thumbnailDirectPath,
			}
			: undefined
	}
	if (!quoted.text && !hasUsableMediaKeys(media)) return // nothing worth stashing

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
	// View-once wrappers hide the real node: classify by the inner content so
	// a view-once video/audio is not collapsed into the old hardcoded image.
	const target = viewOnceInner(m) ?? m
	for (const [rawType, newType] of Object.entries(allMsgTypes)) {
		const res = findKey(target, rawType)
		if (res) return [newType, rawType] as [MsgTypes, str] // ['image', 'imageMessage']
	}

	return ['event', Object.keys(target ?? {})[0] ?? ''] // return raw type
}

export { checkMatch, downloadMedia, getCtx, getMsgType, hasUsableMediaKeys, isViewOnceContent }
