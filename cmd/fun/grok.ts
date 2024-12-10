import { Cmd, CmdCtx } from '../../map.js'
import { xAI } from '../../util/api.js'

export default class extends Cmd {
	constructor() {
		super({
			alias: ['x'],
			cooldown: 5,
			subCmds: ['reset'],
		})
	}

	async run({ bot, msg, args, user, sendUsage }: CmdCtx) {
		if (!args[0]) return sendUsage()

		if (args[0] === this.subCmds[0]) {
			user.grok = [] // reset user ctx/conversation history
			if (!args[1]) return bot.react(msg, 'ok')
			args.shift() // remove 'reset' from prompt
		}

		await bot.react(msg, 'think')

		let response = await xAI(user, args.join(' ')).catch((e) => {
			console.error(e, 'CMD/GROK')
			bot.react(msg, 'x')
			return e.message.encode()
		})
		response = response
			.replaceAll('**', '*')
			.replaceAll('#', '>')

		await bot.send(msg, `\`- Grok-beta:\` ${response}`)
		bot.react(msg, 'ok')
		return
	}
}
