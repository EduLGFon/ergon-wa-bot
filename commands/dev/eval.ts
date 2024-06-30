import { cleanTemp, Cmd, CmdCtx, delay, Lang, prisma, runCode, runner } from '../../map.js'
import { inspect } from 'node:util'
import { Duration } from 'luxon'

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
		const lang = (langs.includes(args[0] as 'py') ? args.shift() : null) as
			| Lang
			| null
		const code = args.join(' ')
		let output, startTime: num
		bot.react(msg, '⌛')

		if (!lang) {
			const { user, group, cmd, callCmd, t, sendUsage } = ctx
			let evaled
			prisma
			delay // i may need it, so TS won't remove from build if it's here

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
		const RAMusage = process.memoryUsage().rss.bytes()

		const text = `*[👨‍💻] - ${(lang || 'EVAL').toUpperCase()}* [${dur} - ${RAMusage}]\n` +
			output.trim()

		cleanTemp()

		bot.send(msg, text)
		bot.react(msg, '✅')
		return
	}
}
