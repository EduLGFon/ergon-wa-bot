import { GroupMetadata, GroupParticipant, proto } from 'baileys'
import { Collection, Msg, prisma } from '../map.js'

export default class Group {
	id: str
	owner?: str
	name: str
	// group name modification date
	// nameTimestamp?: num;
	// creation?: num;
	desc?: str
	// is set when the group only allows admins to change group settings
	restrict?: bool
	// is set when the group only allows admins to write msgs
	announce?: bool
	// number of group members/participants
	members: GroupParticipant[]
	size: num
	// ephemeral?: num;
	invite?: str
	/** the person who added you */
	author?: str

	cachedMsgs: Collection<string, proto.IMessageKey>

	constructor(g: GroupMetadata) {
		this.id = g.id
		this.name = g.subject
		this.owner = g.owner
		// this.nameTimestamp = g.subjectTime;
		// this.creation = g.creation;
		this.desc = g.desc
		this.restrict = g.restrict
		this.announce = g.announce
		this.members = g.participants
		this.size = g.size || this.members.length
		// this.ephemeral = g.ephemeralDuration;
		this.invite = g.inviteCode
		this.author = g.author
		this.cachedMsgs = new Collection(Group.getMsgsCacheLimit())
	}

	static getMsgsCacheLimit() {
		// Change here, change in all places.
		return 200
	}

	async countMsg(author: str) {
		await prisma.msgs.upsert({
			where: {
				author_group: {
					author,
					group: this.id,
				},
			},
			create: {
				author,
				group: this.id,
				count: 1,
			},
			update: {
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
			.slice(0, limit || Group.getMsgsCacheLimit()) // limits the number of msgs

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
