import { getMedia, sendOrEdit } from 'util/message.ts'
import defaults from 'defaults' with { type: 'json' }
import gemini from 'util/gemini.ts'
import { CmdCtx } from 'types'
import Cmd from 'class/cmd.ts'
import { Message } from 'wa'

export default class extends Cmd {
	constructor() {
		super({
			alias: ['g'],
			cooldown: 5_000,
			subCmds: ['reset', 'pro'],
		})
	}
	async run({ msg, args, user, send, react, startTyping }: CmdCtx) {
		if (!args[0]) return send('Por favor escreva um prompt')
		const model = defaults.ai.gemini25 // default gemini model

		if (args[0] === this.subCmds[0]) { // reset
			user.gemini = []
			if (!args[1]) return react('ok')
			args.shift()
		}

		// if (args[0] === this.subCmds[1]) { // use pro model
		// 	if (!args[1]) return send('Por favor escreva um prompt')
		// 	model = defaults.ai.gemini25 // gemini 2.5 flash preview
		// 	args.shift()
		// }

		await startTyping()
		const file = await getMedia(msg) // download msg media or quoted msg media

		const streamMsg = { // Workaround to make the variable always point to
			msg: {}, // this memory space
		} as { msg: Message }
		await gemini({
			model,
			input: args.join(' '),
			user,
			chat: msg.to, // this chat id
			file,
			callBack: sendOrEdit, // edit msg while gemini writes it
			args: [streamMsg!, msg.to], // arguments to pass to the callback
		})
			.catch(async (e) => {
				console.log('GEMINI', e, 'red')
				await gemini({
					model: defaults.ai.gemini2,
					input: args.join(' '),
					user,
					chat: msg.to, // this chat id
					file,
					callBack: sendOrEdit, // edit msg while gemini writes it
					args: [streamMsg!, msg.to], // arguments to pass to the callback
				})
			})
		react('think')
		return
	}
}
