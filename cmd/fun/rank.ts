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

	async run({ send, user, msg, group }: CmdCtx) {
		group = group!
		let text = `*[🏆] - Rank de mensagens*\n\n`

		const msgs = await group.getCountedMsgs()
		const members = group.members.map((m) => m.id)

		let pos = 1
		for (const i in msgs) {
			const count = msgs[i].count.toLocaleString(user.lang)
			// it converts 10000 to 10.000 (10,000 if you're "american")

			const member = await getUser({ id: msgs[i].author }) as User
			let name = (member.name || member.phone).trim()

			if (!members.includes(member.lid)) continue //name = `~${name}~`
			// it means user is not a member from this group anymore

			text += `${pos}. ${name}: *${count}*\n`
			pos++
		}

		send(text.trim(), { quoted: msg })
	}
}
