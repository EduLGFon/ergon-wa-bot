import { AnyMessageContent } from 'baileys'
import { Cmd, CmdCtx } from '../../map.js'

export default class extends Cmd {
	constructor() {
		super({
			aliases: ['r'],
		})
	}

	async run({ msg, args, bot, sendUsage, t }: CmdCtx) {
		if (!msg.isMedia && !msg.quoted.isMedia) return sendUsage()

		let target = msg.isMedia ? msg : msg.quoted
		let buffer = await bot.downloadMedia(target)

		if (!buffer) return bot.send(msg, t('sticker.nobuffer'))

		await bot.react(msg, '⌛')

		const msgObj = {
			viewOnce: args[0] === 'y' ? false : true,
		} as AnyMessageContent

		// @ts-ignore
		msgObj[target.type === 'sticker' ? 'image' : target.type] = buffer

		await bot.send(msg, msgObj)

		bot.react(msg, '✅')
		return
	}
}
