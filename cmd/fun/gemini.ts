import { api, Cmd, CmdCtx, gemini } from '../../map.js'

export default class extends Cmd {
	constructor() {
		super({
			aliases: ['g'],
			cooldown: 4,
		})
	}

	async run({ bot, msg, args, user, sendUsage }: CmdCtx) {
		if (!args[0]) return sendUsage()
		await bot.react(msg, '⌛')

		let preprompt =
			`Create a short and detailed response in ${user.lang} to the prompt, and use bold to highlight key words.
Template:
> *Short response:*\n{brief_response}
> *Detailed response:*\n{detailed_response}
Prompt: `
		let model = api.aiModel.geminiPro
		let buffer, mime, stream: Promise<CmdCtx> | CmdCtx

		if (msg.isMedia || msg?.quoted?.isMedia) {
			const target = msg.isMedia ? msg : msg.quoted
			buffer = await bot.downloadMedia(target)
			mime = target.mime
		}

		if (args[0] === 'pure') {
			args.shift()
			preprompt = ''
		}

		await gemini({
			preprompt,
			content: args.join(' '),
			model,
			buffer,
			mime,
			user,
			callback,
		})

		async function callback({ text, reason, promptTokens, responseTokens }: aiResponse) {
			const response =
				`${promptTokens} tokens to *${model}* (${responseTokens} tokens with ${reason})\n\n${text}`

			if (!stream) stream = bot.send(msg, response).then((m) => stream = m)
			// @ts-ignore
			else if (stream.msg) bot.editMsg(stream.msg, response)
			return
		}

		bot.react(msg, '✅')
		return
	}
}
