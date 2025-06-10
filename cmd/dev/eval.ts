import { Cmd, CmdCtx, defaults, delay, isEmpty, Lang, prisma, runCode } from '../../map.js'
import { inspect } from 'node:util'
import baileys from 'baileys'

export default class extends Cmd {
	constructor() {
		super({
			alias: ['e'],
			access: { restrict: true },
			cooldown: 0,
		})
	}

	async run(ctx: CmdCtx) {
		const { args, bot, msg, user, group, cmd, t, sendUsage } = ctx
		const langs = Object.keys(defaults.runner)
		// all supported programming languages

		// Language to be runned
		const lang: Lang = langs.includes(args[0]) ? args.shift() : 'eval'
		const code = args.join(' ')
		let output, startTime: num
		// await bot.react(msg, 'loading')

		if (lang === 'eval') {
			let evaled // run on this thread
			prisma
			delay // i may need it, so TS won't remove from build if it's here
			baileys
			isEmpty

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

			output = await runCode(lang, code)
			// runCode: run on a child process
		}

		// execution duration
		const duration = (Date.now() - startTime!).duration(true)
		const RAM = process.memoryUsage().rss.bytes() // current RAM usage

		if (output === 'undefined') output = ''
		else output = '\n' + output.trim()

		const text = `\`$ ${duration}/${RAM}\`` + output

		await bot.send(msg, text)
		// bot.react(msg, 'ok')
		return
	}
}
