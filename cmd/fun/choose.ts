import { Cmd, CmdCtx } from '../../map.js'

export default class extends Cmd {
	constructor() {
		super({})
	}
	async run({ t, bot, msg, args, sendUsage }: CmdCtx) {
		if (!args[0] || !msg.text.includes(',')) return sendUsage()

		const options = args.join(' ').split(',') // split options
		if (!options[1]) return sendUsage()

		const chosen = options[Math.floor(Math.random() * options.length)]
		// get random option

		bot.send(msg, t('choose.result', { chosen: chosen.encode() }))
		return
	}
}
