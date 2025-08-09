import { Cmd, CmdCtx, runCode } from '../../map.js'

export default class extends Cmd {
	constructor() {
		super({
			alias: ['run'],
			access: { restrict: true },
			cooldown: 0,
		})
	}

	async run({ args, send }: CmdCtx) {
		const startTime = Date.now()
		const code = args.join(' ')

		let output = await runCode('fish', code)
		// runCode: run on a child process

		// execution duration
		const duration = (Date.now() - startTime).duration(true)
		const RAM = process.memoryUsage().rss.bytes() // current RAM usage

		const text = `\`$ ${duration}/${RAM}\`\n` + output

		send(text)
		return
	}
}
