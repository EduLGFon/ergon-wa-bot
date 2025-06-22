import { PrismaClient } from '@prisma/client'
import { Group, User } from '../map.js'
import cache from './cache.js'
import bot from '../wa.js'

const prisma = new PrismaClient()

export default prisma
export { createUser, getGroup, getUser }

async function createUser({ phone, name }: { phone: str; name?: str }): Promise<User> {
	let id = Number(phone)
	if (process.env.DATABASE_URL) {
		const data = await prisma.users.create({
			data: {
				phone,
				name,
			},
		})
		id = data.id
	}

	const user = new User({ id, phone, name })
	cache.users.add(user.id, user)

	return user
}

async function getUser(
	{ id, phone, name }: { id?: num; phone?: str; name?: str },
): Promise<User | undefined> {
	if (phone) {
		// search by phone on cache
		const number = phone!.parsePhone()
		const data = cache.users.find((u) => u.phone === number)
		if (data) return data
		// not on cache, so lets search on db
		const dbUser = await prisma.users.findUnique({ where: { phone: number } })
		if (!dbUser) {
			// not on db, so it's a new user
			return await createUser({ phone: number, name })
			// createUser() will add it to cache
		}

		// found on db, so lets create a User instance
		const user = new User(dbUser)
		cache.users.add(user.id, user)
		return user
	}
	// no phone provided, so lets search by id on cache
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
	cache.groups.set(group.id, group)
	return group
}
