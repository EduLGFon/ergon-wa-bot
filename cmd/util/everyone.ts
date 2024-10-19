import { Cmd, CmdCtx, delay } from '../../map.js'

export default class extends Cmd {
	constructor() {
		super({
			access: {
				dm: false,
				admin: true, /** Admin: true
				 * (it means only group admins can run this cmd)
				 * I don't think it's really necessary bc
				 * every group member can just mention everyone
				 * and then copy/paste it every time, but
				 * I was asked for it by a user. So, I did it for him
				 */
			},
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
