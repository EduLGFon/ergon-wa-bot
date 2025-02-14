import { Cmd, CmdCtx, runCode } from '../../map.js'

export default class extends Cmd {
	constructor() {
		super({
			alias: ['run'],
			access: { restrict: true },
			cooldown: 0,
		})
	}

	async run({ args, bot, msg }: CmdCtx) {
		const startTime = Date.now()
		const code = args.join(' ')

		bot.react(msg, 'loading')
		let output = await runCode('zsh', code)
		// runCode: run on a child process

		// execution duration
		const duration = (Date.now() - startTime).duration(true)
		const RAM = process.memoryUsage().rss.bytes() // current RAM usage

		const text = `\`$ ZSH (${RAM} | ${duration})\`\n` +
			output.trim().encode()

		bot.send(msg, text)
		bot.react(msg, 'ok')
		return
	}
}
