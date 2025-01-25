import { Cmd, CmdCtx } from '../../map.js'

export default class extends Cmd {
	constructor() {
		super({
			access: {
				dm: false,
				groups: true,
				needsDb: true,
			},
		})
	}

	async run({ bot, msg, group }: CmdCtx) {
		let text = `*[🏆] - Rank*\n\n`

		const msgs = await group!.getCountedMsgs()

		for (const i in msgs) {
			const { author, count } = msgs[i]

			const user = await bot.getUser({ id: author })

			text += `*${Number(i) + 1}.* ${user?.name || author}: *${count}* messages\n`
		}

		bot.send(msg, text)
		return
	}
}
