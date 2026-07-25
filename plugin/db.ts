import { drizzle } from 'drizzle-orm/postgres-js'
import * as schema from '@conf/schema.ts'
import postgres from 'postgres'

const connectionString = Deno.env.get('DATABASE_URL')
let dbClient: ReturnType<typeof drizzle<typeof schema>> | undefined = undefined

if (connectionString) {
	const sql = postgres(connectionString, { max: 5 })
	dbClient = drizzle(sql, { schema })
} else {
	print('DB', 'No DATABASE_URL found. Running without DB connection.', 'red')
}

export const db = dbClient

import Group from '@class/group.ts'
import User from '@class/user.ts'
import cache from '@plugin/cache.ts'
import bot from '@plugin/bot.ts'
import { eq } from 'drizzle-orm'

export async function createUser({ lid, name }: { lid: str; name?: str }): Promise<User> {
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

export async function getGroup(id: str): Promise<Group> {
	let group = cache.groups.get(id)
	if (group) return group
	const data = await bot.sock.groupMetadata(id)
	group = new Group(data)
	cache.groups.add(group.id, group)
	return group
}
