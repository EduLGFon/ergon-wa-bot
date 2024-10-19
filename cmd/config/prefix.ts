import { Cmd, CmdCtx } from '../../map.js'

export default class extends Cmd {
	constructor() {
		super({
			aliases: ['prefixo'],
		})
	}

	async run({ t, user, msg, bot, args, sendUsage }: CmdCtx) {
		if (!args[0] || args[0].length > 3) return sendUsage()

		user.prefix = args[0].slice(0, 3)

		bot.send(msg, t('prefix.changed', { prefix: user.prefix }))
		return
	}
}
