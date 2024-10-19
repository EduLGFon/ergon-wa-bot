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
		const amount = Number(args[0]) // amount of msgs to be deleted for everyone-

		if (amount === 0) return bot.send(msg, t('clean.noAmount'))

		if (!isValidPositiveIntenger(amount)) return sendUsage()

		if (group.cachedMsgs.size < amount) bot.send(msg, t('clean.deleted'))
		// the bot can only delete up to 200 cached msgs

		for (const m of group.getCachedMsgs(amount)) {
			await bot.deleteMsg(m) // delete msg for everyone
			group.cachedMsgs.remove(m.id!) // remove it from cache

			await delay(300) // wait .3s before deleting another msg
		}

		return
	}
}
