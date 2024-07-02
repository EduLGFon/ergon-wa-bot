import { cleanTemp, Cmd, CmdCtx, delay, Lang, prisma, runCode, runner } from '../../map.js'
import { inspect } from 'node:util'
import { Duration } from 'luxon'
import baileys from 'baileys'

export default class extends Cmd {
	constructor() {
		super({
			aliases: ['e'],
			access: { onlyDevs: true },
			cooldown: 0,
		})
	}

	async run(ctx: CmdCtx) {
		const { args, bot, msg } = ctx
		const langs = Object.keys(runner)

		// Language to be runned
		const lang: Lang = langs.includes(args[0]) ? args.shift() : 'eval'
		const code = args.join(' ')
		let output, startTime: num
		bot.react(msg, '⌛')

		if (lang === 'eval') {
			const { user, group, cmd, callCmd, t, sendUsage } = ctx
			let evaled
			prisma
			delay // i may need it, so TS won't remove from build if it's here
			baileys

			try {
				evaled = code.includes('await')
					? await eval(`(async () => { ${code} })()`)
					: await eval(code!)
			} catch (e: any) {
				evaled = e.message
			}

			output = inspect(evaled, { depth: null })
		} else {
			startTime = Date.now()

			output = await runCode({ lang, code })
		}

		const dur = Duration
			.fromMillis(Date.now() - startTime! || 1)
			.rescale()
			.toHuman({ unitDisplay: 'narrow' })
		const RAM = process.memoryUsage().rss.bytes()

		const text = `\`$ ${lang} (${RAM} | ${dur})\`\n` +
			output.trim().encode()

		cleanTemp()

		bot.send(msg, text)
		bot.react(msg, '✅')
		return
	}
}
