import { randomDelay } from '../../util/functions.js'
import { Cmd, CmdCtx } from '../../map.js'

export default class extends Cmd {
	constructor() {
		super({
			cooldown: 5_000,
			access: {
				dm: false,
			},
		})
	}

	async run({ startTyping, send, args, msg, group }: CmdCtx) {
		await startTyping()
		await randomDelay(1_000, 2_000)
		/** Delay, ok. But why?
		 * Avoid WA bans.
		 */

		await send({
			text: args[0] ? `*@everyone:* "${args.join(' ').encode()}"` : '*@everyone*',
			mentions: group?.members?.map((m) => m.id),
		}, { quoted: msg })
	}
}
