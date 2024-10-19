import { GroupMetadata, GroupParticipant, proto } from 'baileys'
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

	cachedMsgs: Collection<str, proto.IMessageKey>

	constructor(id: str, g: GroupMetadata) {
		this.id = id
		this.name = g.subject
		// this.owner = g.owner
		// this.nameTimestamp = g.subjectTime;
		// this.creation = g.creation;
		// this.desc = g.desc
		this.restrict = g.restrict
		this.announce = g.announce
		this.members = g.participants
		this.size = g.size || this.members.length
		// this.ephemeral = g.ephemeralDuration;
		this.invite = g.inviteCode
		this.author = g.author
		this.cachedMsgs = new Collection(db.groupDefault.msgsCacheLimit)
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

	getCachedMsgs(limit?: number): proto.IMessageKey[] {
		const msgs = this.cachedMsgs
			.filter((m: proto.IMessageKey) => m.id) // Checks if the key really exists
			.reverse() // latest msgs first
			.slice(0, limit || db.groupDefault.msgsCacheLimit) // limits msgs amount

		return msgs
	}

	cacheMsg(msg: Msg) {
		return this.cachedMsgs.add(msg.key.id!, msg.key)
	}

	async checkData() {
		// I don't save any data of groups, but I let this func here bc
		// if some day I store groups data,
		// the code will be prepared to check these data

		return this
	}
}
