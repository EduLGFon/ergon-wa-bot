// deno-lint-ignore-file no-unused-vars
import defaults from 'defaults' with { type: 'json' }
import { delay, now } from 'util/functions.ts'
import { inspect } from 'node:util'
import cache from 'util/cache.ts'
import { CmdCtx } from 'types'
import Cmd from 'class/cmd.ts'
import db from 'plugin/db.ts'

export default class extends Cmd {
	constructor() {
		super({
			name: 'eval',
			alias: ['e'],
			access: {
				restrict: true,
			},
		})
	}

	async run({ bot, msg, args, user }: CmdCtx) {
		defaults
		cache
		delay
		now
		db

		let output = ''
		const startTime = Date.now()
		try {
			/** Dynamic async eval: put code on async function if it includes 'await'
			 * you will need to use 'return' on the end of your code
			 * if you want to see a returned value
			 */
			output = args.includes('await')
				? await eval(`(async () => { ${args.join(' ')} })()`)
				: await eval(args.join(' '))

			output = inspect(output, { depth: null })
		} catch (e: any) {
			output = e.message || e
		}

		// code execution duration
		const duration = (Date.now() - startTime).duration(true)
		const RAM = Deno.memoryUsage().rss.bytes() // current RAM usage

		output = `\`$ ${duration}/${RAM}\`` + (output === 'undefined' ? '' : '\n' + output.trim())

		bot.sendMessage(msg.to, output)
		return
	}
}
