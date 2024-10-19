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
		text += createStr('🌐', '.WhatsApp_', whatsapp)

		// Calculate DB Ping
		const db = await measurePing(prisma.users.findUnique, { where: { id: user.id } })
		text += createStr('🥜', '..Database_', db)

		// Calculate Runner ping
		const runner = await measurePing(fetch, 'http://localhost:3077/ping')
		text += createStr('👟', '....Runner_..', runner)

		// Calculate main server ping
		const main = await measurePing(fetch, 'http://localhost:3001/ping')
		text += createStr('✨', '.....Main_.....', main)

		// Calculate reminder ping
		const reminder = await measurePing(fetch, 'http://localhost:7361/ping')
		text += createStr('🔔', '..Reminder..', reminder)

		await bot.send(msg, text)
		bot.react(msg, 'ok')
		return
	}
}
function createStr(emoji: str, name: str, data: { status: str; ping: num }) {
	return `[${emoji}]` + name.bold() + '|' + data.status.bold() + '|' +
		`${data.ping}ms`.align(8).bold() + '\n'
}
async function measurePing(func: Func, ...args: any) {
	const data = await new Promise(async (res) => {
		let status = '..Off..'
		let ping = -1
		setTimeout(() => res({ ping, status }), 2_000)

		const startTime = Date.now()
		const data = await func(...args).catch(() => { })
		ping = Date.now() - startTime

		if (data?.status === 200 || data?.chat || data?.id) status = '..On..'
		else ping = -1

		return res({
			ping,
			status,
		})
	})

	return await data as { ping: num; status: str }
}
