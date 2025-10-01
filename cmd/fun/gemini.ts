import { cleanMemories } from '../../plugin/memories.js'
import { randomDelay } from '../../util/functions.js'
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
		if (!args[0]) return send('Por favor escreva um prompt')
		let model = 2 // default gemini model

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
			model = 3
			args.shift()
		}
		await startTyping()
		await sendPrompt(model)
		await randomDelay(2_000, 3_000) // wait before reacting for anti-bot detection reasons
		react('sparkles')

		async function sendPrompt(model: num, error?: any) {
			if (model < 0) {
				print('GEMINI', 'No more models to try', 'red')
				return await send(`Nenhum modelo disponível para este prompt\n\n${error.message}`)
			}

			return await gemini({
				model,
				input: args.join(' '),
				user,
				chat: msg.chat, // this chat id
				file: await getMedia(msg),
			}).catch(async (e): Promise<any> => {
				print(defaults.ai.gemini_chain[model], e)
				return await sendPrompt(model - 1, e) // try next model
			})
		}
	}
}
