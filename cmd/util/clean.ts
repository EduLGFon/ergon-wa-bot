import { Cmd, CmdCtx, delay, isValidPositiveIntenger } from '../../map.js'

export default class extends Cmd {
	constructor() {
		super({
			cooldown: 10,
		})
	}

	async run({ bot, msg, args, group, sendUsage, t }: CmdCtx) {
		group = group!
		let disclaimerMsg
		const amount = Number(args[0]) // amount of msgs to be deleted for everyone-

		if (amount === 0) return bot.send(msg, t('clean.noAmount'))

		if (!isValidPositiveIntenger(amount)) return sendUsage()

		if (group.msgs.size < amount) {
			disclaimerMsg = await bot.send(msg, t('clean.deleted', { msgsSize: group.msgs.size }))
		}
		// the bot can only delete up to 200 cached msgs

		const msgs = group.getMsgs(amount)
		for (const [k, v] of msgs) {
			await bot.deleteMsg(v.key) // delete msg for everyone
			group.msgs.delete(Number(k)) // delete it from cache

			await delay(500)
		}

		await bot.deleteMsg(msg)
		if (disclaimerMsg) bot.deleteMsg(disclaimerMsg.msg)
		return
	}
}
