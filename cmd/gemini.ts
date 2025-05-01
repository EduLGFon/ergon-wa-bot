import { getMedia, sendOrEdit } from 'util/functions.ts'
import emojis, { restrictEmojis } from 'util/emojis.ts'
import defaults from 'defaults' with { type: 'json' }
import { gemini } from 'util/api.ts'
import { CmdCtx } from 'types'
import Cmd from 'class/cmd.ts'
import { Message } from 'wa'

export default class extends Cmd {
	constructor() {
		super({
			name: 'gemini',
			alias: ['g'],
			cooldown: 5_000,
			subCmds: ['reset', 'pro'],
		})
	}
	async run({ bot, msg, args, user }: CmdCtx) {
		if (!args[0]) return bot.sendMessage(msg.to, 'Por favor escreva um prompt')
		let model = defaults.ai.gemini

		if (args[0] === this.subCmds[0]) {
			user.gemini = []
			if (!args[1]) return msg.react(restrictEmojis['ok'])
			args.shift()
		}

		if (args[0] === this.subCmds[1]) {
			if (!args[1]) return bot.sendMessage(msg.to, 'Por favor escreva um prompt')
			model = defaults.ai.gemini_pro
			args.shift()
		}

		const file = await getMedia(msg)

		const streamMsg = {
			msg: {},
		} as { msg: Message }
		await gemini({
			model,
			input: args.join(' '),
			user,
			file,
			callBack: sendOrEdit,
			args: [bot, streamMsg!, msg.to],
		})
			.then(() => msg.react(emojis['think']))
			.catch((e) => {
				console.log('CMD/GEMINI', e, 'red')
				bot.sendMessage(msg.to, String(e.message || e))
			})
		return
	}
}
