import { execSync } from 'node:child_process'
import { Cmd, CmdCtx, runCode } from '../../map.js'
import { Duration } from 'luxon'

export default class extends Cmd {
	constructor() {
		super({
			aliases: ['run'],
			access: { onlyDevs: true },
			cooldown: 0,
		})
	}

	async run({ args, bot, msg }: CmdCtx) {
		const startTime = Date.now()

		let output = await runCode({
			lang: 'zsh',
			code: args.join(' '),
		})

		const dur = Duration
			.fromMillis(Date.now() - startTime)
			.rescale()
			.toHuman({ unitDisplay: 'narrow' })

		const RAM = process.memoryUsage().rss.bytes()

		const text = `*[👨‍💻] - Child Process* ${dur} - ${RAM}\n` +
			output.trim().encode()

		bot.send(msg, text)
		return
	}
}
