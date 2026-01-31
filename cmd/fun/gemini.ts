import { cleanMemories } from '../../plugin/memories.js'
import { Cmd, CmdCtx, defaults } from '../../map.js'
import { getMedia } from '../../util/messages.js'
import gemini from '../../util/geminiApi.js'

export default class extends Cmd {
	constructor() {
		super({
			alias: ['g'],
			cooldown: 5_000,
			subCmds: ['clean', 'reset', 'pro'],
		})
	}

	async run({ msg, args, react, user, send, startTyping }: CmdCtx) {
		if (!args[0]) return send('Por favor escreva um prompt', { quoted: msg })
		let model = defaults.ai.gemini_chain[1] // default gemini model

		if (args[0] === this.subCmds[0]) { // clean subcmd
			user.gemini = [] // clean user gemini context

			if (!args[1]) return react('ok')
			args.shift() // users can also clean ctx and send the next prompt
		}

		if (args[0] === this.subCmds[1]) { // reset
			user.gemini = [] // clean user gemini context
			await cleanMemories(user)

			if (!args[1]) return react('ok')
			args.shift() // users can also reset and send the next prompt
		}

		if (args[0] === this.subCmds[2]) { // use pro model
			if (!args[1]) return send('Por favor escreva um prompt')
			model = defaults.ai.gemini_chain[2]
			args.shift()
		}
		await startTyping()

		gemini({
			model,
			input: args.join(' '),
			user,
			msg, // this message
			file: await getMedia(msg),
		}).catch(async (e): Promise<any> => {
			print('GEMINI', 'Model not available', 'red')
			print(model, e)
			send(`> *${model}:* Modelo não disponível. Tente novamente mais tarde ou amanhã.`, {
				quoted: msg,
			})
		})
	}
}
