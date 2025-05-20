import Cmd from 'class/cmd.ts'
import { CmdCtx } from 'types'
import { delay } from 'util/functions.ts'

export default class extends Cmd {
	constructor() {
		super({
			access: {
				dm: false,
				groups: true,
			},
		})
	}

	async run({ send, msg, startTyping }: CmdCtx) {
		const chat = await msg.getChat()
		// @ts-ignore library has the wrong types for this
		const mentions = chat?.groupMetadata?.participants.map((p) => p.id.user)
		await startTyping()
		await delay(3_000)

		await send('@everyone', { mentions })
	}
}
