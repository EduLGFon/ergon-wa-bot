import { Cmd, CmdCtx, prisma } from '../../map.js'

export default class extends Cmd {
	constructor() {
		super({
			aliases: ['re'],
		})
	}

	async run({ bot, user, msg, args, sendUsage }: CmdCtx) {
		if (!args[1]) return sendUsage()

		const matchMs = args.join(' ').toMs()
		print(matchMs)

		const time = Date.now() + matchMs[0]

		args = args.filter((a) => !matchMs[1].includes(a))

		await prisma.reminders.create({
			data: {
				author: user.id,
				chat: msg.chat,
				msg: args.join(' '),
				remindAt: String(time),
			},
		})

		bot.react(msg, 'ok')
	}
}
