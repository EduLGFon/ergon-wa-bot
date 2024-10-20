import { Cmd, CmdCtx, languages } from '../../map.js'

export default class extends Cmd {
	constructor() {
		super({
			alias: ['lang'],
		})
	}

	async run({ t, bot, args, msg, user, sendUsage }: CmdCtx) {
		if (!languages.includes(args[0])) return sendUsage()

		user.lang = args[0]

		bot.send(msg, t('language.changed', { lng: user.lang }))
		return
	}
}
