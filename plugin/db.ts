// Postgres client - drizzle with postgres-js driver
// Provides getUser, getGroup and createUser helpers
// Runs without DB when DATABASE_URL is missing
import { drizzle } from 'drizzle-orm/postgres-js'
import * as schema from '@conf/schema.ts'
import cache from '@plugin/cache.ts'
import Group from '@class/group.ts'
import User from '@class/user.ts'
import { eq } from 'drizzle-orm'
import bot from '@plugin/bot.ts'
import postgres from 'postgres'

const connectionString = Deno.env.get('DATABASE_URL')
let dbClient: ReturnType<typeof drizzle<typeof schema>> | undefined = undefined

if (connectionString) {
	const sql = postgres(connectionString, { max: 5 })
	dbClient = drizzle(sql, { schema })
} else {
	console.log(
		'%c[DB] - No DATABASE_URL found. Running without DB connection.',
		'color: red; font-weight: bold;',
	)
}

export const db = dbClient

async function createUser({ lid, name }: { lid: str; name?: str }): Promise<User> {
	let id = Number(lid.parsePhone()) || Date.now()
	if (Deno.env.get('DATABASE_URL')) {
		const data = await db?.insert(schema.users)
			.values({ lid, name })
			.returning()
			.catch((e) => {
				print('DB', `Failed to create user ${lid}:`, e, 'red')
				return undefined
			})
		if (data && data[0]) id = data[0].id
	}

	const user = new User({ id, lid, name })
	cache.users.add(user.id, user)
	return user
}

export async function getUser(
	{ id, lid, name }: { id?: num; lid?: str; name?: str },
): Promise<User | undefined> {
	if (lid) {
		const data = cache.users.find((u) => u.lid === lid)
		if (data) return data
		const dbUser = await db?.select().from(schema.users).where(eq(schema.users.lid, lid)).catch(
			() => undefined,
		)

		if (!dbUser || !dbUser[0]) return await createUser({ lid, name })

		const user = new User(dbUser[0])
		cache.users.add(user.id, user)
		return user
	}
	const data = cache.users.find((u) => u.id === id)
	if (data) return data

	const dbUser = id
		? await db?.select().from(schema.users).where(eq(schema.users.id, id))
		: undefined
	if (dbUser && dbUser[0]) {
		const user = new User(dbUser[0])
		cache.users.add(user.id, user)
		return user
	}
	return
}

export async function getGroup(id: str): Promise<Group | null> {
	let group = cache.groups.get(id)
	if (group) return group
	let data
	try {
		data = await bot.sock.groupMetadata(id)
	} catch (e) {
		// 403 forbidden = bot was removed or is no longer a member; there is
		// no metadata to fetch. Return null so callers skip instead of
		// crashing the event handler with a noisy stack dump.
		if (isForbiddenGroupError(e)) return null
		throw e
	}
	group = new Group(data)
	cache.groups.add(group.id, group)
	return group
}

// True when Baileys failed groupMetadata because the bot may not query the
// group (removed, never a member). Boom shape seen in prod: data 403 with
// an "Error: forbidden" message.
function isForbiddenGroupError(e: unknown): boolean {
	try {
		const anyErr = e as { data?: unknown; message?: unknown; description?: unknown }
		if (anyErr?.data === 403) return true
		const msg = typeof anyErr?.message === 'string' ? anyErr.message : ''
		const desc = typeof anyErr?.description === 'string' ? anyErr.description : ''
		return msg.includes('forbidden') || desc.includes('forbidden')
	} catch {
		return false
	}
}
