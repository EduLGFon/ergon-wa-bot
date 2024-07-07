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

		const preprompt = `Respond to the following prompt in ${user.lang} and give a short answer unless asked for a long answer.:\n`
		let model = api.aiModel.gemini
		let buffer, mime

		if (args[0] === 'pro') {
			args.shift()
			model = api.aiModel.geminiPro
		}

		if (msg.isMedia || msg?.quoted?.isMedia) {
			const target = msg.isMedia ? msg : msg.quoted
			buffer = await bot.downloadMedia(target)
			mime = target.mime
		}

		const { response, tokens } = await gemini({
			preprompt,
			content: args.join(' '),
			model,
			buffer,
			mime,
		})

		bot.send(
			msg,
			`${tokens[0]} + ${tokens[1]} tokens to *${model}* (${tokens[2]} tokens):\n\n${response}`,
		)
		bot.react(msg, '✅')
		return
	}
}
