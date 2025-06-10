import { Cmd, CmdCtx } from '../../map.js'
import { models } from '../../util/api.js'

export default class extends Cmd {
	constructor() {
		super({
			alias: ['gpt', 'gemini', 'g'],
			cooldown: 4,
		})
	}

	async run({ bot, msg, args, sendUsage }: CmdCtx) {
		const ai = args.shift() as 'gpt'
		const func = models[ai]

		if (!func) return sendUsage()
		await bot.react(msg, 'loading')
		let buffer, mime

		if (msg.isMedia || msg?.quoted?.isMedia) {
			const target = msg.isMedia ? msg : msg.quoted
			buffer = await bot.downloadMedia(target)
			mime = target.mime
		}

		const { response, model } = await func({
			content: args.join(' '),
			model: '',
			buffer,
			mime,
		})

		bot.send(msg, `*${model}*:\n\n${response}`)
		bot.react(msg, 'ok')
	}
}
