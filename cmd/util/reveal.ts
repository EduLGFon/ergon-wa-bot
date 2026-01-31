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

	async run({ msg, send, t }: CmdCtx) {
		const media = await getMedia(msg)
		if (!media) return send(t('sticker.nobuffer'), { quoted: msg })
		await randomDelay(1_000, 2_000)

		const msgObj = {
			caption: media.target.text ? `*View once revealed:* "${media.target.text.encode()}"` : '*View once revealed*',
		} as AnyMessageContent

		// @ts-ignore send sticker as image
		msgObj[media.target.type === 'sticker' ? 'image' : media.target.type] = media.buffer

		send(msgObj, { quoted: msg })
		return
	}
}
