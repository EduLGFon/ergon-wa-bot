import Cmd from 'class/cmd.ts'
import { CmdCtx } from 'types'
import { inspect } from 'node:util'
import { randomEmoji } from 'util/emojis.ts'

export default class extends Cmd {
	constructor() {
		super({
			name: 'eval',
			alias: ['e'],
			access: {
				admin: true,
			},
		})
	}

	async run({ bot, msg, args, user }: CmdCtx) {
		if (!args[0]) return msg.reply('Please provide code to evaluate.')
		randomEmoji

		const code = args.join(' ')
		const result = await eval(code)

		bot.sendMessage(msg.to, inspect(result, { depth: null }))
		return
	}
}
