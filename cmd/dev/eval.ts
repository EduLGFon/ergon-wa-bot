import { Cmd, CmdCtx, defaults, delay, isEmpty, prisma, runCode } from '../../map.js'
import { readFile, writeFile } from 'node:fs/promises'
import cache from '../../plugin/cache.js'
import { inspect } from 'node:util'
import fs from "node:fs/promises"
import bot from '../../wa.js'

export default class extends Cmd {
	constructor() {
		super({
			alias: ['e'],
			access: { restrict: true },
			cooldown: 0,
		})
	}

	async run(ctx: CmdCtx) {
		const { args, bot, msg, user, group, cmd, t, send, react, startTyping } = ctx
		const langs = Object.keys(defaults.runner)
		// all supported programming languages

		// Language to be runned
		const lang = langs.includes(args[0]) ? args.shift() as Lang : 'eval'
		const startTime = Date.now() // start time for execution duration
		let output = '' // output of the code execution

		if (lang === 'eval') {
			let evaled // run on this thread
			prisma
			delay // i may need it, so TS won't remove from build if it's here
			isEmpty
			cache
			bot
			writeFile
			readFile

			try {
				/** Dynamic async eval: put code on async function if it includes 'await'
				 * you will need to use 'return' on the end of your code
				 * if you want to see a returned value
				 */
				evaled = args.includes('await')
					? await eval(`(async () => { ${args.join(' ')} })()`)
					: await eval(args.join(' '))
			} catch (e: any) {
				evaled = e.message || e
			}

			output = inspect(evaled, { depth: null })
			// inspect output: stringify obj to human readable form
		} else {
			output = await runCode(lang, args.join(' '))
			// runCode: run on a child process
		}

		// execution duration
		const duration = (Date.now() - startTime!).duration(true)
		const RAM = process.memoryUsage().rss.bytes() // current RAM usage

		const text = `\`$ ${duration}/${RAM}\`` +
			(output === 'undefined' ? '' : '\n' + output.trim())

		send(text)
		return
	}
}
