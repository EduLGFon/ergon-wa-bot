import { Chat, Message, MessageMedia, MessageSendOptions } from 'wa'
import emojis from './emojis.ts'
import bot from 'main'

export { getMedia, react, send, sendOrEdit, startTyping }

// download media from message or quoted message
// if there's no media, return undefined
async function getMedia(msg: Message, startTyping?: Func, sendRecording?: bool) {
	const target = msg.hasMedia ? msg : (msg.hasQuotedMsg ? await msg.getQuotedMessage() : null)

	if (!target || !target.hasMedia) return
	if (startTyping) await startTyping(sendRecording)
	const media = await target.downloadMedia()
	if (!media) return

	return {
		data: media.data,
		mime: media.mimetype,
		target,
	}
}

// simple abstraction to send a msg
async function send(this: str, text: str | MessageMedia, options?: MessageSendOptions) {
	if (options?.mentions) options.mentions = options.mentions.map((phone) => phone + '@c.us')
	return await bot.sendMessage(this, text, { sendSeen: false, ...options })
}

// simple abstraction to react to a msg
async function react(this: Message, emoji: keyof typeof emojis) {
	return await this.react(emojis[emoji])
}

// sendOrEdit: send a message or edit it if it was already sent
// this is used to edit the message while the AI is writing
async function sendOrEdit(data: { msg: Message }, chat: str, text: str) {
	// @ts-ignore Checking if the message was sent
	if (data.msg?.id) {
		await data.msg.edit(text).catch((e) => console.log('Failed to edit message', e))
	} else data.msg = await send.bind(chat)(text)
}

async function startTyping(this: Chat, sendRecording?: bool) {
	return await (sendRecording ? this.sendStateRecording() : this.sendStateTyping())
}
