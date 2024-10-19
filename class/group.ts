import { GroupMetadata, GroupParticipant } from 'baileys'
import { Collection, db, Msg, prisma } from '../map.js'

export default class Group {
	id: str
	owner?: str
	name: str
	// nameTimestamp?: num;
	// group name modification date
	// creation?: num;
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

	msgs: Collection<Msg, Msg>

	constructor(id: str, g: GroupMetadata | Group) {
		this.id = id
		// @ts-ignore Shut up TypeScript
		this.name = g.subject || g.name
		// this.owner = g.owner
		// this.nameTimestamp = g.subjectTime;
		// this.creation = g.creation;
		// this.desc = g.desc
		this.restrict = g.restrict
		this.announce = g.announce
		// @ts-ignore
		this.members = g.participants || g.members
		this.size = g.size || this.members.length
		// this.ephemeral = g.ephemeralDuration;
		// @ts-ignore
		this.invite = g.inviteCode || g.invite
		this.author = g.author
		this.msgs = new Collection(db.group.msgsLimit)
	}

	async countMsg(author: str) { // +1 to group member msgs count
		await prisma.msgs.upsert({
			where: {
				author_group: {
					author,
					group: this.id,
				},
			},
			create: { // create user counter
				author,
				group: this.id,
				count: 1,
			},
			update: { // or add 1  to count
				count: { increment: 1 },
			},
		})
		return
	}

	async getCountedMsgs(author?: str) {
		if (author) {
			return await prisma.msgs.findUnique({
				where: {
					author_group: {
						author,
						group: this.id,
					},
				},
			})
		}

		const msgs = await prisma.msgs.findMany({
			where: {
				group: this.id,
			},
		})

		return msgs
	}

	getMsgs(limit?: number) {
		return this.msgs.entries()
	}

	async checkData() {
		// I don't save any data of groups, but I let this func here bc
		// if some day I store groups data,
		// the code will be prepared to check these data

		return this
	}
}
