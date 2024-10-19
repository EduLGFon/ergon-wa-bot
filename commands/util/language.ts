import { Cmd, CmdCtx, languages } from '../../map.js'


export default class extends Cmd {
	constructor() {
		super({
			aliases: ['lang', 'idioma'],
		})
	}

	async run({ t, bot, args, msg, user, sendUsage }: CmdCtx) {
		if (!languages.includes(args[0])) return sendUsage()

		user.lang = args[0].slice(0, 2)

		bot.send(msg, t('language.changed', { lng: user.lang }))
		return
	}
}
