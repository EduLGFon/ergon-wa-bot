import { Cmd, CmdCtx, prisma } from '../../map.js'

export default class extends Cmd {
	constructor() {
		super({
			aliases: ['p'],
		})
	}
	async run({ t, bot, user, msg }: CmdCtx) {
		// Calculate WA Ping
		let startTime = Date.now()
		await bot.react(msg, '⌛')
		const WAPing = Date.now() - startTime

		// Calculate DB Ping
		startTime = Date.now()
		await prisma.users.findUnique({ where: { id: user.id } })
		const DBPing = Date.now() - startTime

		bot.send(
			msg,
			`*[🐧] - Ping:*\n[📞] WA API: *${WAPing}ms*\n[🐘] PostgreSQL: *${DBPing}ms*`,
		)
		bot.react(msg, '✅')
		return
	}
}
