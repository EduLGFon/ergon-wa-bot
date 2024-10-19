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

		let model = api.aiModel.gemini
		let buffer, mime, stream: Promise<CmdCtx> | CmdCtx
		const language = `langs.${user.lang}`.t('en')
		const instruction =
			`Create a short, concise answer and, only if necessary, a long, detailed one. Always answer in ${language} and use bold for all important words and keywords.`

		if (msg.isMedia || msg?.quoted?.isMedia) {
			const target = msg.isMedia ? msg : msg.quoted
			buffer = await bot.downloadMedia(target)
			mime = target.mime
		}

		await gemini({
			instruction,
			prompt: args.join(' '),
			model,
			buffer,
			mime,
			chat: user._chat,
			callback,
		})

		async function callback({ text, reason, inputSize, tokens }: aiResponse) {
			const response = `> ${inputSize} > *${model}* > ${tokens} (${reason})\n${text}`

			if (!stream) stream = bot.send(msg, response).then((m) => stream = m)
			// @ts-ignore
			else if (stream.msg) bot.editMsg(stream.msg, response)
			return
		}

		bot.react(msg, '✅')
		return
	}
}
