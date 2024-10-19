import { Cmd, CmdCtx, isValidPositiveIntenger } from '../../map.js'
import { delay } from 'baileys'

export default class extends Cmd {
	constructor() {
		super({
			cooldown: 10,
		})
	}

	async run({ bot, msg, args, group, sendUsage, t }: CmdCtx) {
		group = group!
		const amount = Number(args[0])

		if (amount === 0) return bot.send(msg, t('clean.noAmount'))

		if (!isValidPositiveIntenger(amount)) return sendUsage()

		if (group.cachedMsgs.size < amount) bot.send(msg, t('clean.deleted'))

		for (const m of group.getCachedMsgs(amount)) {
			await bot.deleteMsg(m)
			group.cachedMsgs.remove(m.id!)

			await delay(300)
		}

		return
	}
}
