import { cleanTemp, Cmd, CmdCtx, delay, Lang, prisma, runCode, runner } from '../../map.js'
import { inspect } from 'node:util'
import { Duration } from 'luxon'
import baileys from 'baileys'

export default class extends Cmd {
	constructor() {
		super({
			alias: ['e'],
			access: { onlyDevs: true },
			cooldown: 0,
		})
	}

	async run(ctx: CmdCtx) {
		const { args, bot, msg, user, group, cmd, t, sendUsage } = ctx
		const langs = Object.keys(runner)
		// all supported programming languages

		// Language to be runned
		const lang: Lang = langs.includes(args[0]) ? args.shift() : 'eval'
		const code = args.join(' ')
		let output, startTime: num
		bot.react(msg, 'loading')

		if (lang === 'eval') {
			let evaled // run on this thread
			prisma
			delay // i may need it, so TS won't remove from build if it's here
			baileys

			try {
				/** Dynamic async eval: put code on async function if it includes 'await'
				 * you will need to use 'return' on the end of your code
				 * if you want to see a returned value
				 */
				evaled = code.includes('await')
					? await eval(`(async () => { ${code} })()`)
					: await eval(code!)
			} catch (e: any) {
				evaled = e.message
			}

			output = inspect(evaled, { depth: null })
			// inspect output: stringify obj to human readable form
		} else {
			startTime = Date.now()

			output = await runCode({ lang, code })
			// runCode: run on a separate thread
		}

		const dur = Duration // code execution duration
			.fromMillis(Date.now() - startTime! || 1)
			.rescale()
			.toHuman({ unitDisplay: 'narrow' })
		const RAM = process.memoryUsage().rss.bytes() // current RAM usage

		const text = `\`$ ${lang} (${RAM} | ${dur})\`\n` +
			output.trim().encode()

		cleanTemp() // clean temp folder

		bot.send(msg, text)
		bot.react(msg, 'ok')
		return
	}
}
