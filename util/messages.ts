import { AnyMessageContent, downloadMediaMessage, proto } from 'baileys'
import { CmdCtx, emojis, getCtx, Msg, msgMeta, User } from '../map.js'
import cache from '../plugin/cache.js'
import { logger } from './proto.js'
import { getFixedT } from 'i18next'
import bot from '../wa.js'

export { deleteMessage, editMsg, getMedia, react, send, sendOrEdit, startTyping }

async function getMedia(msg: Msg, startTyping?: Func) {
	const target = msg.hasMedia ? msg : msg.quoted

	if (!target || !target.hasMedia) return
	if (startTyping) await startTyping()

	const media = await downloadMediaMessage(target, 'buffer', {}, {
		reuploadRequest: bot.sock.updateMediaMessage,
		logger,
	})

	return {
		data: media,
		mime: target.mime, // media mimetype like image/png,
		target,
	}
}

async function startTyping(this: str) {
	return await bot.sock.sendPresenceUpdate('composing', this)
}

// simple abstraction to send a msg
async function send(this: str, text: str | AnyMessageContent, user?: User) {
	// reply?: baileys.proto.IWebMessageInfo)
	let content = text

	if (typeof text === 'string') {
		// it's a string, so it can be a text or a template string

		if (user) {
			// it's a template string, so we can use user's lang
			const t = getFixedT(user.lang)

			if (text.startsWith('usage.')) { // it's a cmd usage
				text = text.replace('usage.', '')

				cache.cmds.get('help').run({ args: [text], send: send.bind(this), user, t })
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
	) //, quote)

	// convert raw msg on cmd context
	return await getCtx(msg!)
}

// simple abstraction to react to a msg
async function react(this: Msg, emoji: str) {
	// @ts-ignore find emojis by name | 'ok' => '✅'
	const text = emojis[emoji] || emoji
	await send.bind(this.chat)({ react: { text, key: this.key } })
	return
}

// simple abstraction to edit a msg
async function editMsg(this: Msg, text: str) {
	const { chat, key } = this
	return await send.bind(chat)({ edit: key, text })
}

// simple abstraction to delete a msg
async function deleteMessage(this: Msg | proto.IMessageKey) {
	const { chat, key } = msgMeta(this, '')
	// get msg metadata

	await send.bind(chat)({ delete: key })
	return
}

// sendOrEdit: send a message or edit it if it was already sent
// this is used to edit the message while the AI is writing
async function sendOrEdit(data: { msg: Msg }, chat: str, text: str) {
	if (data.msg?.key?.id) {
		await editMsg.bind(data.msg)(text).catch((e) => print('Failed to edit message', e))
		// @ts-ignore
	} else data.msg = await send.bind(chat)(text)
}
