import { PrismaClient } from '@prisma/client'
import Group from '../class/group.js'
import User from '../class/user.js'
import cache from './cache.js'
import bot from '../wa.js'

const prisma = new PrismaClient()

export default prisma
export { createUser, getGroup, getUser }

async function createUser({ lid, name }: { lid: str; name?: str }): Promise<User> {
	let id = Number(lid.parsePhone())
	if (process.env.DATABASE_URL) {
		const data = await prisma.users.create({
			data: { // create user on DB if there is one
				lid,
				name,
			},
		})
		id = data.id
	}

	const user = new User({ id, lid, name })
	cache.users.add(user.id, user)

	return user
}

async function getUser(
	{ id, lid, name }: { id?: num; lid?: str; name?: str },
): Promise<User | undefined> {
	if (lid) {
		// search by lid on cache
		const data = cache.users.find((u) => u.lid === lid)
		if (data) return data
		// not on cache, so lets search it on db
		const dbUser = await prisma.users.findFirst({ where: { lid } })
			.catch(() => {}) // there is no DB. Let's just ignore it

		if (!dbUser) {
			// not on db, so it's a new user
			return await createUser({ lid, name })
			// createUser() will also add it to cache
		}

		// found on db, so let's create a User instance
		const user = new User(dbUser)
		cache.users.add(user.id, user)
		return user
	}
	// no lid provided, so lets search by id on cache
	const data = cache.users.find((u) => u.id === id)
	if (data) return data

	// not on cache, so lets search on db
	const dbUser = await prisma.users.findUnique({ where: { id } })
	if (dbUser) {
		// found on db, so lets create a User instance
		const user = new User(dbUser)
		cache.users.add(user.id, user)
		return user
	}
	// not found on db nor on cache, so return undefined
	// bc i can't create a user without a phone number
	return
}

async function getGroup(id: str): Promise<Group> {
	// search by id on cache
	let group = cache.groups.get(id)
	if (group) return group
	// not on cache, so lets search on WA
	const data = await bot.sock.groupMetadata(id)
	// if (!data) return
	// group does not exist on WA, so return undefined

	group = new Group(data)
	cache.groups.add(group.id, group)
	return group
}
