import { Cmd, CmdCtx } from '../../map.js'
import translate from 'google-translate'

export default class extends Cmd {
	constructor() {
		super({
			alias: ['t'],
			cooldown: 5_000,
		})
	}

	async run({ args, send, t }: CmdCtx) {
		if (!args[1]) return send('usage.translate')

		const toLang = args.shift() // language to what the text will be translated
		try {
			const output = await translate(args.join(' '), { to: toLang })

			const text = `*[🌐] - ${t('translate.desc')}*\n` + // Google translate title
				`*${output?.from.language.iso}  ➟  ${toLang}*\n` + // lang identify
				output?.text.encode() // translation

			send(text)
		} catch (e) {
			print('CMD/TRANSLATE', e, 'red')
			send('usage.translate')
		}
		return
	}
}
