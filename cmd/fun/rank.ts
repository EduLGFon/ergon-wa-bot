import { Cmd, CmdCtx, GroupMsg, prisma, User } from '../../map.js'

export default class extends Cmd {
	constructor() {
		super({
			access: {
				dm: false,
				groups: true,
			},
		})
	}

	async run({ bot, msg, group }: CmdCtx) {
		let text = `*[🏆] - ${group!.name}'s Rank*\n\n`

		const msgs = await group!.getCountedMsgs() as GroupMsg[]

		for (const i in msgs) {
			const { author, count } = msgs[i]

			const user = await bot.getUser({ id: author })

			text += `*${Number(i) + 1}.* ${user?.name || author}: *${count}* messages\n`
		}

		bot.send(msg, text)
		return
	}
}
