import defaults from '@conf/defaults.json' with { type: 'json' }
import type { GroupMetadata, GroupParticipant } from 'baileys'
import { type Msg } from '@conf/types/types.d.ts'
import Collection from '@class/collection.ts'
import { desc, eq, sql } from 'drizzle-orm'
import { msgs } from '@conf/schema.ts'
import { db } from '@db'

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
		this.name = (data as GroupMetadata).subject || (data as Group).name
		this.nameTimestamp = (data as GroupMetadata).subjectTime || (data as Group).nameTimestamp
		this.creation = data.creation
		this.restrict = data.restrict
		this.announce = data.announce
		this.members = (data as GroupMetadata).participants || (data as Group).members
		this.size = data.size || this.members.length
		this.invite = (data as GroupMetadata).inviteCode || (data as Group).invite
		this.author = data.author
		this.msgs = new Collection(defaults.cache.groupMsgs)

		if ('msgs' in data && data.msgs) {
			this.msgs.iterate(data.msgs)
		}
	}

	async countMsg(msg: Msg) {
		// +1 to group member msgs count
		this.msgs.add(msg.key.id!, msg) // add it to cache
		if (!Deno.env.get('DATABASE_URL') || msg.isBot) return

		await db?.insert(msgs).values({
			author: msg.author,
			group: this.id.parsePhone(),
		}).onConflictDoUpdate({
			target: [msgs.author, msgs.group],
			set: { count: sql`${msgs.count} + 1` },
		})
	}

	async getCountedMsgs() {
		if (!Deno.env.get('DATABASE_URL')) return []

		const dbMsgs = await db?.select().from(msgs).where(eq(msgs.group, this.id.parsePhone()))
			.orderBy(desc(msgs.count))

		return dbMsgs || []
	}

	checkData() {
		return this
	}
}
