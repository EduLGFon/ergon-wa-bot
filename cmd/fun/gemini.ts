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
		if (args[0] === this.subCmds[0]) { // use gemini pro model
			if (!args[1]) return sendUsage() // if there is no prompt
			model = api.aiModel.geminiPro
		}

		if (args[0] === this.subCmds[1]) {
			user.geminiCtx = [] // reset user ctx/conversation history
			if (!args[1]) return bot.react(msg, 'ok')
		}

		await bot.react(msg, 'loading')
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
		})

		async function callback({ text, reason, inputSize, tokens }: aiResponse) {
			// Gemini will call this function every .5s to send or edit response updates
			const response = `> ${inputSize} > *${model}* > ${tokens} (${reason})\n${text}`

			if (!stream) stream = bot.send(msg, response).then((m) => stream = m)
			// @ts-ignore send msg and only try to edit when it was really sent
			else if (stream.msg) bot.editMsg(stream.msg, response)
			return
		}

		bot.react(msg, 'ok')
		return
	}
}
