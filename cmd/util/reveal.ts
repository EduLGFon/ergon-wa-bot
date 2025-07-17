import { randomDelay } from '../../util/functions.js'
import { getMedia } from '../../util/messages.js'
import { AnyMessageContent } from 'baileys'
import { Cmd, CmdCtx } from '../../map.js'

export default class extends Cmd {
	constructor() {
		super({
			alias: ['r'],
		})
	}

	async run({ msg, send, startTyping, t }: CmdCtx) {
		const media = await getMedia(msg)
		if (!media) return send(t('sticker.nobuffer'))
		await startTyping()
		await randomDelay()

		const msgObj = {
			caption: media.target.text.encode()
		} as AnyMessageContent

		// @ts-ignore send sticker as image
		msgObj[media.target.type === 'sticker' ? 'image' : media.target.type] = media.buffer

		send(msgObj)
		return
	}
}
