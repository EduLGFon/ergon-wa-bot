import { Cmd, CmdCtx } from '../../map.js'
import translate from 'google-translate'

export default class extends Cmd {
	constructor() {
		super({
			alias: ['t'],
			cooldown: 5,
		})
	}

	async run({ bot, msg, args, sendUsage, t }: CmdCtx) {
		if (!args[1]) return sendUsage()

		const toLang = args.shift() // language to what the text will be translated
		try {
			const output = await translate(args.join(' '), { to: toLang })

			const text = `*[🌐] - ${t('translate.desc')}*\n` + // Google translate title
				`*${output?.from.language.iso}  ➟  ${toLang}*\n` + // lang identify
				output?.text.encode() // translation

			bot.send(msg, text)
		} catch (e: any) {
			print(e)
			sendUsage()
		}
		return
	}
}
