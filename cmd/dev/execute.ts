import { execSync } from 'node:child_process'
import { Cmd, CmdCtx, runCode } from '../../map.js'
import { Duration } from 'luxon'

export default class extends Cmd {
	constructor() {
		super({
			alias: ['run'],
			access: { onlyDevs: true },
			cooldown: 0,
		})
	}

	async run({ args, bot, msg }: CmdCtx) {
		const startTime = Date.now()
		const code = args.join(' ')

		bot.react(msg, 'loading')
		let output = await runCode({
			lang: 'zsh',
			code,
		})
		/** runCode: run on a separate thread
		 * it's handled by runner instance
		 */

		const dur = Duration // code execution duration
			.fromMillis(Date.now() - startTime)
			.rescale()
			.toHuman({ unitDisplay: 'narrow' })

		const RAM = process.memoryUsage().rss.bytes() // current RAM usage

		const text = `\`$ ZSH (${RAM} | ${dur})\`\n` +
			output.trim().encode()

		bot.send(msg, text)
		bot.react(msg, 'ok')
		return
	}
}
