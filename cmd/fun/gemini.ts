import { api, Cmd, CmdCtx, gemini } from '../../map.js'

export default class extends Cmd {
	constructor() {
		super({
			alias: ['g'],
			subCmds: ['pro', 'reset'],
			cooldown: 4,
		})
	}

	async run({ bot, msg, args, user, sendUsage }: CmdCtx) {
		if (!args[0]) return sendUsage()
		let model = api.aiModel.gemini // gemini flash model

		if (args[0] === this.subCmds[1]) {
			user.geminiCtx = [] // reset user ctx/conversation history
			if (!args[1]) return bot.react(msg, 'ok')
			args.shift() // remove 'reset' from prompt
		}

		if (args[0] === this.subCmds[0]) { // use gemini pro model
			if (!args[1]) return sendUsage() // if there is no prompt
			model = api.aiModel.geminiPro
			args.shift() // remove 'pro' from prompt
		}

		await bot.react(msg, 'think')
		let buffer, mime, stream: Promise<CmdCtx> | CmdCtx
		const language = `langs.${user.lang}`.t('en')
		const instruction = // dynamic initial instruction
			`Create a short, concise answer and, only if necessary, a long, detailed one. Always answer in ${language} and use bold for all important words and keywords.`

		if (msg.isMedia || msg?.quoted?.isMedia) {
			const target = msg.isMedia ? msg : msg.quoted // include msg or quoted msg media

			buffer = await bot.downloadMedia(target)
			mime = target.mime // media mimetype like image/png
		}

		await gemini({
			instruction,
			prompt: args.join(' '),
			model,
			buffer,
			mime,
			user,
			callback,
		}).catch((e) => {
			bot.react(msg, 'x')
			bot.send(msg, e.message.encode())
		})

		async function callback({ text, tokens, finish }: aiResponse) {
			// Gemini will call this function every .5s to send or edit response updates
			const response = ` - *${model}* (${tokens}):\n${text}`

			if (!stream) stream = bot.send(msg, response).then((m) => stream = m)
			// if it's the last chunk (final response)
			else if (finish) return bot.editMsg((await stream).msg, response)
			// wait msg is sent and edit it
			/** I did it bc
			 * sometimes Gemini API may generate all chunks
			 * faster than WhatsApp can send msgs. It could cause
			 * some content loss on this cmd. So, when it's finish
			 * bot will wait until msg is sent
			 */
			// @ts-ignore only try to edit when it was really sent
			else if (stream.msg) bot.editMsg(stream.msg, response)
			return
		}

		bot.react(msg, 'ok')
		return
	}
}
