// Reveal command - reveals view-once media via getMedia
// Needed to let users reopen expiring photos and voice
import { type CmdCtx } from '@conf/types/types.d.ts'
import { getMedia } from '@util/msgAbstractions.ts'
import { randomDelay } from '@util/functions.ts'
import { type AnyMessageContent } from 'baileys'
import Cmd from '@class/cmd.ts'

export default class extends Cmd {
	constructor() {
		super({
			alias: ['r'],
		})
	}

	async run({ msg, send, react, t }: CmdCtx) {
		const media = await getMedia(msg).catch((_e) => react('x'))
		if (!media) {
			if (msg.quoted?.mediaUnavailable === 'view-once') {
				return send(t('reveal.unavailable'), { quoted: msg })
			}
			return send(t('sticker.nobuffer'), { quoted: msg })
		}
		await randomDelay(1_000, 2_000)

		const msgObj = {
			caption: media.target.text
				? `*View once revealed:* "${media.target.text.encode()}"`
				: '*View once revealed*',
		} as AnyMessageContent // Use the resolved type: a view-once video must send as video even when
		 // the wrapper's own type was generic; stickers reveal as images.
		;(msgObj as any)[media.type === 'sticker' ? 'image' : media.type] = media.buffer

		send(msgObj, { quoted: msg })
	}
}
