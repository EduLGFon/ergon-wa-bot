import { existsSync, mkdirSync, readdirSync, unlink } from 'node:fs'
import { Baileys, bot, Group, sticker, User } from '../map.js'

// Delay: make the code wait for some time
async function delay(time: num) { // resolve promise at timeout
	return await new Promise((r) => setTimeout(() => r(true), time))
}

// cacheAllGroups: cache all groups the bot is on
async function cacheAllGroups(bot: Baileys) {
	const groupList = await bot.sock.groupFetchAllParticipating()

	let groups = Object.keys(groupList)

	groups.forEach(async (g) => {
		const group = new Group(groupList[g])

		bot.groups.add(group.id, await group.checkData())
	})

	print('CACHE', `${groups.length} groups cached.`, 'blue')
	return
}

// genStickerMeta: Generate the author/pack for a sticker
function genStickerMeta(user: User, group?: Group) {
	return {
		pack: sticker.packName.join('\n'),

		author: sticker.author.join('\n')
			.replace('{username}', user.name) // replace placeholders with
			.replace('{link}', bot.link) // useful infos
			.replace('{group}', group?.name || 'Not a group'),
	}
}

// findKey: Search for a key inside an object
function findKey(obj: any, key: str): any {
	// if the obj has this key, then return it
	if (obj?.hasOwnProperty(key)) return obj[key]

	// search the key on all objs inside the main obj
	for (const property of Object.getOwnPropertyNames(obj)) {
		// without this, the msg type could be the quoted msg type.
		if (property === 'quotedMessage' && key !== 'quotedMessage') continue

		const value = obj[property]
		// if the property is a obj, call findKey() recursively
		if (typeof value === 'object') {
			const result = findKey(value, key)

			if (result !== undefined) return result
		}

		// If it's a method, check if it is the searched value
		if (typeof value === 'function' && property === key) return value
	}

	return
}

// Validate whether a variable actually has a useful value
function isEmpty(value: unknown): bool { // check if a array/obj is empty
	if (!value) return true

	if (Array.isArray(value)) {
		return value.length === 0 ||
			value.some((item) => item === undefined || isEmpty(item))
	} else if (typeof value === 'object') {
		return Object.keys(value!).length === 0
		//|| Object.values(value!).some((item) => item === undefined || isEmpty(item));
	}

	return true
}

// isValidPositiveIntenger: validate a number
function isValidPositiveIntenger(value: num): bool {
	return !Number.isNaN(value) && value > 0 && Number.isInteger(value)
}

// cleanTemp: Clean temp folder
async function cleanTemp() {
	if (!existsSync('settings/temp')) mkdirSync('settings/temp')

	const files = readdirSync('settings/temp')

	files.forEach((f) => unlink(`settings/temp/${f}`, () => {}))

	return
}

export {
	cacheAllGroups,
	cleanTemp,
	delay,
	findKey,
	genStickerMeta,
	isEmpty,
	isValidPositiveIntenger,
}
