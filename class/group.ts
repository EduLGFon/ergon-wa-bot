import { Collection, defaults, type Msg, prisma, User } from '../map.js'
import type { GroupMetadata, GroupParticipant } from 'baileys'

export default class Group {
	id: str
	owner?: str
	name: str
	nameTimestamp?: num
	// group name modification date
	creation?: num
	desc?: str
	restrict?: bool
	// restrict: is set when group only allows admins to change group settings
	announce?: bool
	// announce: is set when group only allows admins to write msgs
	members: GroupParticipant[]
	size: num
	// size: group members size
	// ephemeral?: num;
	invite?: str // invite link
	author?: str
	// author: the person who added you

	msgs: Collection<str, Msg>

	constructor(data: Group | GroupMetadata) {
		this.id = data.id
		// @ts-ignore Shut up TypeScript
		this.name = data.subject || data.name
		// this.owner = g.owner
		//@ts-ignore
		this.nameTimestamp = data?.subjectTime || data?.nameTimestamp
		this.creation = data.creation
		// this.desc = g.desc
		this.restrict = data.restrict
		this.announce = data.announce
		// @ts-ignore
		this.members = data?.participants || data?.members
		this.size = data.size || this.members.length
		// this.ephemeral = data.ephemeral || data.ephemeralDuration;
		// @ts-ignore
		this.invite = data.inviteCode || data.invite
		this.author = data.author
		this.msgs = new Collection(defaults.cache.groupMsgs)

		// @ts-ignore
		this.msgs.iterate(data?.msgs)
	}

	async countMsg(user: User, msg: Msg) { // +1 to group member msgs count
		this.msgs.add(msg.key.id!, msg)
		if (!process.env.DATABASE_URL || msg.isBot) return

		await prisma.msgs.upsert({
			where: {
				author_group: {
					author: user.id,
					group: this.id.parsePhone(),
				},
			},
			create: { // create user counter
				author: user.id,
				group: this.id.parsePhone(),
			},
			update: { // or add 1  to count
				count: { increment: 1 },
			},
		})
		return
	}

	async getCountedMsgs(author?: num) {
		if (!process.env.DATABASE_URL) return []

		// if (author) {
		// 	return await prisma.msgs.findUnique({
		// 		where: {
		// 			author_group: {
		// 				author,
		// 				group: this.id.parsePhone(),
		// 			},
		// 		},
		// 	})
		// }

		const msgs = await prisma.msgs.findMany({
			where: {
				group: this.id.parsePhone(),
			},
			orderBy: {
				count: 'desc',
			},
		})

		return msgs
	}

	// async indexParticipants(data: Group | GroupMetadata, bot: Baileys) {
	// 	let participants: { phone: str; admin: any }[] = []
	// 	const members: User[] = []

	// 	if ((data as Group).members) { // data is a cached group
	// 		data = data as Group
	// 		participants = data.members.map((m) => {
	// 			return { phone: m.phone, admin: m.admin }
	// 		})
	// 	} else { // data is a raw group metadata
	// 		data = data as GroupMetadata
	// 		participants = data.participants.map((p) => {
	// 			return { phone: p.id, admin: p.admin }
	// 		})
	// 	}

	// 	for (const m of participants) {
	// 		const user = await getUser({ phone: m.phone })
	// 		user.admin = m.admin
	// 		members.push(user)
	// 	}

	// 	return members
	// }

	async checkData() {
		// this.members = await this.indexParticipants(this.members as any, bot)
		// I don't save any data of groups, but I let this func here bc
		// if some day I store groups data,
		// the code will be prepared to check these data

		return this
	}
}
