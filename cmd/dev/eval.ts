import defaults from '@conf/defaults.json' with { type: 'json' }
import { type CmdCtx } from '@conf/types/types.d.ts'
import runCode from '@plugin/runCode.ts'
import Cmd from '@class/cmd.ts'

const langs = Object.keys(defaults.runner)

export default class extends Cmd {
	constructor() {
		super({
			alias: ['e'],
			access: { restrict: true },
			cooldown: 0,
		})
	}

	async run(ctx: CmdCtx) {
		const lang = langs.includes(ctx.args[0]) ? (ctx.args.shift() as Lang) : 'eval'
		// code language. can be py (python), rs (rust), cpp (C++), etc.

		const startTime = Date.now() // start time for execution duration
		const output = await runCode(lang, ctx.args.join(' '), '', ctx)

		// execution duration
		const duration = (Date.now() - startTime!).duration(true)
		const RAM = Deno.memoryUsage().rss.bytes() // current RAM usage

		const text = `\`$ ${duration}/${RAM}\`` + // msg header
			(output === 'undefined' ? '' : '\n' + output.trim()) // delete 'undefined' outputs

		ctx.send(text)
	}
}
