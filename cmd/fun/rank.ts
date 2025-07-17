import { getUser } from '../../plugin/prisma.js'
import { Cmd, CmdCtx, User } from '../../map.js'

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

	async run({ send, user, group }: CmdCtx) {
		group = group!
		let text = `*[🏆] - Rank de mensagens*\n\n`

		const msgs = await group.getCountedMsgs()
		const members = group.members.map((m) => m.id)

		for (const i in msgs) {
			const count = msgs[i].count.toLocaleString(user.lang)

			const member = await getUser({ id: msgs[i].author }) as User
			let name = (member.name || member.phone).trim()

			if (!members.includes(member.chat)) name = `~${name}~`

			text += `${Number(i) + 1}. ${name}: *${count}*\n`
		}

		send(text.trim())
		return
	}
}
