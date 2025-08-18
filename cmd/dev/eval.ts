import { Cmd, CmdCtx, defaults, runCode } from '../../map.js'
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
		const lang = langs.includes(ctx.args[0]) ? ctx.args.shift() as Lang : 'eval'

		const startTime = Date.now() // start time for execution duration
		let output = await runCode(lang, ctx.args.join(' '), '', ctx)

		// execution duration
		const duration = (Date.now() - startTime!).duration(true)
		const RAM = process.memoryUsage().rss.bytes() // current RAM usage

		const text = `\`$ ${duration}/${RAM}\`` +
			(output === 'undefined' ? '' : '\n' + output.trim())

		ctx.send(text)
		return
	}
}
