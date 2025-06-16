import { getMedia, sendOrEdit } from '../../util/messages.js'
import { cleanMemories } from '../../plugin/memories.js'
import { Cmd, CmdCtx, Msg } from '../../map.js'
import gemini from '../../util/geminiApi.js'

export default class extends Cmd {
	constructor() {
		super({
			alias: ['g'],
			cooldown: 5,
			subCmds: ['clean', 'reset', 'pro'],
		})
	}

	async run({ msg, args, react, user, send, startTyping }: CmdCtx) {
		if (!args[0]) return send('Por favor escreva um prompt')
		let model = 2 // default gemini model (2.5 flash)

		if (args[0] === this.subCmds[0]) { // clean
			user.gemini = []

			if (!args[1]) return react('ok')
			args.shift()
		}

		if (args[0] === this.subCmds[1]) { // reset
			user.gemini = []
			await cleanMemories(user)

			if (!args[1]) return react('ok')
			args.shift()
		}

		if (args[0] === this.subCmds[2]) { // use pro model
			if (!args[1]) return send('Por favor escreva um prompt')
			model = 3 // gemini 2.5 pro preview
			args.shift()
		}
		await startTyping()
		const file = await getMedia(msg) // download msg media or quoted msg media

		const streamMsg = { // Workaround to make the variable always point to
			msg: {}, // this memory space
		} as { msg: Msg }
		await sendPrompt(model)
		react('sparkles')

		async function sendPrompt(model: num) {
			if (model < 0) {
				console.log('GEMINI', 'No more models to try', 'red')
				return await send('Nenhum modelo disponível para este prompt')
			}

			return await gemini({
				model,
				input: args.join(' '),
				user,
				chat: msg.chat, // this chat id
				file,
				callBack: sendOrEdit, // edit msg while gemini writes it
				args: [streamMsg!, msg.chat], // arguments to pass to the callback
			}).catch(async (e): Promise<any> => {
				console.log(model, e, 'red')
				return await sendPrompt(model - 1) // try next model
			})
		}
	}
}
