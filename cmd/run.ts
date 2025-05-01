import { sendOrEdit } from 'util/functions.ts'
import { run } from 'util/proto.ts'
import { CmdCtx } from 'types'
import Cmd from 'class/cmd.ts'
import { Message } from 'wa'

export default class extends Cmd {
	constructor() {
		super({
			name: 'run',
			alias: ['r'],
			access: {
				restrict: true,
			},
		})
	}

	async run({ bot, msg, args }: CmdCtx) {
		const statusMsg = { msg: {} } as { msg: Message }

		const startTime = Date.now()
		const output = await run(args.join(' '), 1_500, sendOrEdit, [bot, statusMsg!, msg.to])

		const duration = (Date.now() - startTime).duration(true)
		const RAM = Deno.memoryUsage().rss.bytes() // current RAM usage

		await sendOrEdit(
			bot,
			statusMsg!,
			msg.to,
			'`$ ' + duration + '/' + RAM + '`\n```' + output + '```',
		)
		return
	}
}
