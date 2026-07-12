import { Collection, defaults, type Msg, prisma } from '../map.ts'
import type { GroupMetadata, GroupParticipant } from 'baileys'

export default class Group {
	id: str
	owner?: str
	name: str
	nameTimestamp?: num // group name modification date
	creation?: num
	desc?: str
	restrict?: bool // is set when group only allows admins to change group settings
	announce?: bool // is set when group only allows admins to write msgs
	members: GroupParticipant[]
	size: num // group members size
	invite?: str // invite link
	author?: str // the person who added you (this property name really sucks)
	msgs: Collection<str, Msg> // cached msgs

	constructor(data: Group | GroupMetadata) {
		this.id = data.id
		// @ts-ignore Shut up TypeScript
		this.name = data.subject || data.name
		//@ts-ignore
		this.nameTimestamp = data?.subjectTime || data?.nameTimestamp
		this.creation = data.creation
		this.restrict = data.restrict
		this.announce = data.announce
		// @ts-ignore
		this.members = data?.participants || data?.members
		this.size = data.size || this.members.length
		// @ts-ignore
		this.invite = data.inviteCode || data.invite
		this.author = data.author
		this.msgs = new Collection(defaults.cache.groupMsgs)

		// @ts-ignore
		this.msgs.iterate(data?.msgs) // retrieve cached msgs on startup (if exists)
	}

	async countMsg(msg: Msg) {
		// +1 to group member msgs count
		this.msgs.add(msg.key.id!, msg) // add it to cache
		if (!process.env.DATABASE_URL || msg.isBot) return

		await prisma.msgs.upsert({
			// save it on db
			where: {
				author_group: { author: msg.author, group: this.id.parsePhone() },
			},
			create: {
				// create user counter
				author: msg.author,
				group: this.id.parsePhone(),
			},
			update: {
				// or add 1  to count
				count: { increment: 1 },
			},
		})
		return
	}

	async getCountedMsgs() {
		if (!process.env.DATABASE_URL) return []

		const msgs = await prisma.msgs.findMany({
			where: { group: this.id.parsePhone() },
			orderBy: { count: 'desc' },
		})

		return msgs
	}

	async checkData() {
		return this
	}
}
