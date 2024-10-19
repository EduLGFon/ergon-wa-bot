import { Cmd, CmdCtx, delay } from '../../map.js'

export default class extends Cmd {
	constructor() {
		super({
			access: { dm: false },
		})
	}

	async run({ bot, msg, args, group }: CmdCtx) {
		await bot.react(msg, 'loading')
		await delay(2_000)
		/** Delay, ok. But why?
		 * Sometimes Baileys needs a time to generate
		 * some things and it can lead the msg to fail.
		 * So I did it to Baileys have a good time to tidy things up
		 */

		const mentions = group?.members.map((m) => m.id)

		const text = !args[0] ? '@everyone' : args.join(' ')

		await bot.sock.sendMessage(msg.chat, { text, mentions })

		bot.react(msg, 'ok')
	}
}
