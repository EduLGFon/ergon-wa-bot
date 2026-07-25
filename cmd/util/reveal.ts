import { getMedia } from '@util/msgAbstractions.ts'
import { randomDelay } from '@util/functions.ts'
import { type AnyMessageContent } from 'baileys'
import Cmd from '@class/cmd.ts'
import { type CmdCtx } from '@conf/types/types.d.ts'

export default class extends Cmd {
	constructor() {
		super({
			alias: ['r'],
		})
	}

	async run({ msg, send, react, t }: CmdCtx) {
		const media = await getMedia(msg).catch((_e) => react('x'))
		if (!media) return send(t('sticker.nobuffer'), { quoted: msg })
		await randomDelay(1_000, 2_000)

		const msgObj = {
			caption: media.target.text
				? `*View once revealed:* "${media.target.text.encode()}"`
				: '*View once revealed*',
		} as AnyMessageContent
		;(msgObj as any)[media.target.type === 'sticker' ? 'image' : media.target.type] =
			media.buffer

		send(msgObj, { quoted: msg })
	}
}
