import { Cmd, CmdCtx, prisma } from '../../map.js'

export default class extends Cmd {
	constructor() {
		super({
			alias: ['re', 'lembrete'],
		})
	}

	async run({ bot, user, msg, args, sendUsage }: CmdCtx) {
		if (!args[1]) return sendUsage()

		const matchMs = args.join(' ').toMs() // convert string to ms
		// '1s' => 1000ms

		const time = Date.now() + matchMs[0] // remint at this moment

		args = args
			.filter((a) => !matchMs[1].includes(a)) // remove time from remind text

		await prisma.reminders.create({
			data: { // create remind
				author: user.id,
				chat: msg.chat,
				msg: args.join(' ').trim(), // remove unnecessary spaces from str
				remindAt: String(time),
				//isDone
			},
		})

		bot.react(msg, 'ok')
	}
}
