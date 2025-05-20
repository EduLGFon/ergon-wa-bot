import { sendOrEdit } from 'util/message.ts'
import { run } from 'util/proto.ts'
import { CmdCtx } from 'types'
import Cmd from 'class/cmd.ts'
import { Message } from 'wa'

export default class extends Cmd {
	constructor() {
		super({
			alias: ['r'],
			access: {
				restrict: true,
			},
		})
	}

	async run({ msg, args }: CmdCtx) {
		const statusMsg = { msg: {} } as { msg: Message }
		// Workaround to make the variable always point to
		// this memory space

		const startTime = Date.now()
		const output = await run(args, 1_500, sendOrEdit, [
			statusMsg!,
			msg.to, // this chat id
		])

		const duration = (Date.now() - startTime).duration(true)
		const RAM = Deno.memoryUsage().rss.bytes() // current RAM usage

		await sendOrEdit( // it will update the msg while the code is running
			statusMsg!,
			msg.to,
			'`$ ' + duration + '/' + RAM + '`\n```' + output + '```',
		)
		return
	}
}
