// msgAbstractions - Baileys send, react and typing touchpoint
// - wraps sendMsg with media cache lookup and locale templates
import { downloadMedia, getCtx, getMsgType } from '@util/msgTools.ts'
import { type CmdCtx, type Msg } from '@conf/types/types.d.ts'
import type { AnyMessageContent } from 'baileys'
import { randomEmoji } from '@util/emojis.ts'
import cache from '@plugin/cache.ts'
import emojis from '@util/emojis.ts'
import { getFixedT } from 'i18next'
import User from '@class/user.ts'
import bot from '@plugin/bot.ts'

export { getMedia, reactToMsg, sendMsg, startTyping }

async function getMedia(msg: Msg, startTyping?: Func) {
	const target = msg.media ? msg : msg.quoted

	if (!target || !target.media) return
	print(
		'GETMEDIA',
		'target=' + (target === msg ? 'msg' : 'quoted') + ' type=' + target.type,
		'yellow',
	)
	if (startTyping) await startTyping()

	let media = cache.media.get(target.media.url)
	print('GETMEDIA', 'cacheHit=' + !!media, 'yellow')
	if (!media) {
		// media not cached, re-download it using the real Baileys key stored in
		// the message content (imageMessage/videoMessage/stickerMessage/...),
		// not the literal 'media'. Passing 'media' made direct lookup miss and
		// forced the findMediaNode fallback, which fails for quoted media whose
		// downloadMediaMessage call only carries a synthetic quoted key.
		const rawType = getMsgType((target as any).message ?? target)[1]
		await downloadMedia(target, [target.type, rawType])
		media = cache.media.get(target.media.url)
		print('GETMEDIA', 'afterDownload cacheHit=' + !!media, 'yellow')
		if (!media) return // failed to download media
	}

	return {
		target,
		buffer: media.buffer,
		url: target.media.url,
		mime: media.mime,
		length: media.length,
		duration: media.duration,
		type: target.type,
		height: media.height,
		width: media.width,
	}
}

async function startTyping(this: str) {
	return await bot.sock.sendPresenceUpdate('composing', this)
}

// simple abstraction to send a msg
async function sendMsg(
	this: str,
	text: str | AnyMessageContent,
	opts?: { user?: User; quoted?: Msg },
) {
	let content = text

	if (typeof text === 'string') {
		// it's a string, so it can be a text or a template string

		if (opts?.user) {
			// it's a template string, so we can use user's lang
			const t = getFixedT(opts.user.lang)

			if (text.startsWith('usage.')) {
				// it's a cmd usage
				text = text.replace('usage.', '')

				cache.cmds.get('help')!.run({
					args: [text],
					send: sendMsg.bind(this),
					user: opts?.user,
					t,
				} as CmdCtx)
				// run help cmd to get cmd usage
				return {} as CmdCtx
			}
			// it's not a cmd usage, but it's a template string
			content = { text: t(text) } // get the localized text
		} else content = { text } // default content type
	}

	const msg = await bot.sock.sendMessage(
		!this.includes('@') ? this + '@s.whatsapp.net' : this,
		content as AnyMessageContent,
		{ quoted: opts?.quoted },
	)

	// convert raw msg on cmd context
	return await getCtx(msg!)
}

// simple abstraction to react to a msg
async function reactToMsg(this: Msg, emoji: str) {
	const text = emoji === 'random' ? randomEmoji() : (emojis as any)[emoji] || emoji

	await sendMsg.bind(this.chat)({ react: { text, key: this.key } })
}
