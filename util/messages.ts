import { type CmdCtx, emojis, getCtx, type Msg, msgMeta, User } from '../map.js'
import type { AnyMessageContent } from 'baileys'
import { downloadMedia } from './message.js'
import { randomEmoji } from './emojis.js'
import cache from '../plugin/cache.js'
import { getFixedT } from 'i18next'
import bot from '../wa.js'

export { editMsg, getMedia, reactToMsg, sendMsg, sendOrEdit, startTyping }

async function getMedia(msg: Msg, startTyping?: Func) {
	const target = msg.media ? msg : msg.quoted

	if (!target || !target.media) return
	if (startTyping) await startTyping()

	let media = cache.media.get(target.media.url)
	if (!media) {
		// media not cached, download it
		await downloadMedia(target, [target.type, 'media'])
		media = cache.media.get(target.media.url)
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

			if (text.startsWith('usage.')) { // it's a cmd usage
				text = text.replace('usage.', '')

				cache.cmds.get('help')!.run(
					{ args: [text], send: sendMsg.bind(this), user: opts?.user, t } as CmdCtx,
				)
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
	// @ts-ignore find emojis by name | 'ok' => '✅'
	const text = emoji === 'random' ? randomEmoji() : emojis[emoji] || emoji

	await sendMsg.bind(this.chat)({ react: { text, key: this.key } })
}

// simple abstraction to edit a msg
async function editMsg(this: Msg, text: str) {
	const { chat, key } = this
	return await sendMsg.bind(chat)({ edit: key, text })
}

type StreamMsg = { msg: any }
// sendOrEdit: send a message or edit it if it was already sent
// this is used to edit the message while the AI is writing
async function sendOrEdit(data: StreamMsg, text: str, quoted?: Msg) {
	if (data.msg?.key?.id) {
		await editMsg.bind(data.msg)(text).catch((e) => print('Failed to edit message', e))
	} else if (text) data.msg = (await sendMsg.bind(data.msg.chat)(text, { quoted })).msg
}
