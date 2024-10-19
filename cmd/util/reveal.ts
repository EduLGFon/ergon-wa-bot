import { AnyMessageContent } from 'baileys'
import { Cmd, CmdCtx } from '../../map.js'

export default class extends Cmd {
	constructor() {
		super({
			alias: ['r'],
			subCmds: ['forever', 'f'],
		})
	}

	async run({ msg, args, bot, sendUsage, t }: CmdCtx) {
		if (!msg.isMedia && !msg.quoted?.isMedia) return sendUsage()

		let target = msg.isMedia ? msg : msg.quoted // get msg or msg quoted media
		let buffer = await bot.downloadMedia(target)
			.catch((e) => bot.send(msg, `Error: ${e.message.encode()}`))

		if (!buffer) return bot.send(msg, t('sticker.nobuffer'))

		await bot.react(msg, 'loading')
		const msgObj = { // don't send media with view once if user says forever/f
			viewOnce: !this.subCmds.includes(args[0]),
			text: target.text,
		} as AnyMessageContent

		// @ts-ignore send sticker as image
		msgObj[target.type === 'sticker' ? 'image' : target.type] = buffer

		await bot.send(msg, msgObj)

		bot.react(msg, 'ok')
		return
	}
}
