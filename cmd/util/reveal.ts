import { AnyMessageContent } from 'baileys'
import { Cmd, CmdCtx } from '../../map.js'

export default class extends Cmd {
	constructor() {
		super({
			alias: ['r'],
		})
	}

	async run({ msg, args, group, user, bot, sendUsage, t }: CmdCtx) {
		if (!msg.isMedia && !msg.quoted?.isMedia) return sendUsage()

		let target = msg.isMedia ? msg : msg.quoted // get msg or msg quoted media
		let buffer = await bot.downloadMedia(target)
			.catch((e) => {})

		if (!Buffer.isBuffer(buffer)) {
			target = (group || user).msgs.get(target.key?.id)
			buffer = await bot.downloadMedia(target)
				.catch((e) => {})

			if (!Buffer.isBuffer(buffer)) return bot.send(msg, t('sticker.nobuffer'))
		}

		await bot.react(msg, 'loading')
		const msgObj = {
			caption: target.text ? '`' + target.text + '`' : '',
		} as AnyMessageContent

		// @ts-ignore send sticker as image
		msgObj[target.type === 'sticker' ? 'image' : target.type] = buffer

		await bot.send(msg, msgObj)

		bot.react(msg, 'ok')
		return
	}
}
