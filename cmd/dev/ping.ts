import { Cmd, CmdCtx, prisma } from '../../map.js'

export default class extends Cmd {
	constructor() {
		super({
			alias: ['p'],
		})
	}
	async run({ bot, user, msg }: CmdCtx) {
		let text = `*Ping* 🏓\n`

		// Calculate WA Ping
		const whatsapp = await measurePing(bot.react.bind(bot), msg, 'loading')
		text += createStr('🌐', 'WhatsApp', whatsapp)

		// Calculate DB Ping
		const db = await measurePing(prisma.users.findUnique, {
			where: { id: user.id },
		})
		text += createStr('🥜', 'Database', db)

		// Calculate Runner ping
		const runner = await measurePing(fetch, 'http://localhost:3077/ping')
		text += createStr('👟', 'Runner', runner)

		// Calculate main server ping
		const main = await measurePing(fetch, 'http://localhost:3001/ping')
		text += createStr('✨', 'Main', main)

		// Calculate reminder ping
		const reminder = await measurePing(fetch, 'http://localhost:7361/ping')
		text += createStr('🔔', 'Reminder', reminder)

		await bot.send(msg, text)
		bot.react(msg, 'ok')
		return
	}
}
function createStr(emoji: str, name: str, data: { status: str; ping: num }) {
	return `[${emoji}]` + name.align(10).bold() + '|' + data.status.align(10).bold() + '|' +
		`${data.ping}ms`.align(8).bold() + '\n'
}
async function measurePing(func: Function, ...args: any) {
	let status = 'Offline'
	const startTime = Date.now()
	const data = await func(...args).catch(() => {})
	const ping = Date.now() - startTime

	if (data?.status === 200 || data?.msg || data?.id) status = 'Online'

	return {
		ping,
		status,
	}
}
