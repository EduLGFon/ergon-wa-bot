// Group model with msg counting and DB persist.
// Caches recent msgs and syncs member stats to postgres.
// Lets commands read group state without hitting the DB each time.
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

	// Pending counts accumulated in memory and flushed periodically so we
	// don't issue a Postgres upsert on every single inbound message.
	static pendingCounts: Map<string, Map<string, number>> = new Map()
	static flushTimer: ReturnType<typeof setInterval> | null = null
	static flushScheduled = false

	static ensureFlushTimer() {
		if (Group.flushTimer) return
		Group.flushTimer = setInterval(() => {
			void Group.flushCounts()
		}, 5_000)
		Group.flushTimer.unref?.()
	}

	static async flushCounts() {
		if (!Deno.env.get('DATABASE_URL') || !db) return
		const snapshot = Group.pendingCounts
		Group.pendingCounts = new Map()
		for (const [group, authors] of snapshot) {
			for (const [author, n] of authors) {
				try {
					await db?.insert(msgs).values({
						author: Number(author),
						group: group,
						count: n,
					}).onConflictDoUpdate({
						target: [msgs.author, msgs.group],
						set: { count: sql`${msgs.count} + ${n}` },
					})
				} catch (e) {
					// Re-queue on failure for a later retry.
					let g = Group.pendingCounts.get(group)
					if (!g) {
						g = new Map()
						Group.pendingCounts.set(group, g)
					}
					g.set(author, (g.get(author) || 0) + n)
					print('GROUP', `countMsg flush failed for ${group}/${author}: ${e}`, 'red')
				}
			}
		}
	}

	async countMsg(msg: Msg) {
		// +1 to group member msgs count
		this.msgs.add(msg.key.id!, msg) // add it to cache
		if (!Deno.env.get('DATABASE_URL') || msg.isBot) return
		if (!db) return

		Group.ensureFlushTimer()
		const groupKey = this.id.parsePhone()
		let authors = Group.pendingCounts.get(groupKey)
		if (!authors) {
			authors = new Map()
			Group.pendingCounts.set(groupKey, authors)
		}
		authors.set(String(msg.author), (authors.get(String(msg.author)) || 0) + 1)
		await Promise.resolve()
	}

	async getCountedMsgs() {
		if (!Deno.env.get('DATABASE_URL')) return []

		await Group.flushCounts()

		const dbMsgs = await db?.select().from(msgs).where(eq(msgs.group, this.id.parsePhone()))
			.orderBy(desc(msgs.count))

		return dbMsgs || []
	}
}
