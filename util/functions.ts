import { mkdir, readdir, unlink, writeFile } from 'node:fs/promises'
import { Baileys, defaults, Group } from '../map.js'
import cache from '../plugin/cache.js'

export {
	cacheAllGroups,
	cleanTemp,
	delay,
	findKey,
	genRandomName,
	isEmpty,
	isValidPositiveIntenger,
	makeTempFile,
	randomDelay,
}

async function randomDelay() {
	const time = 2_000 + Math.floor(Math.random() * 3_000)
	return delay(time)
}

// Delay: make the code wait for some time
async function delay(time: num) { // resolve promise at timeout
	return await new Promise((r) => setTimeout(() => r(true), time))
}

// cacheAllGroups: cache all groups the bot is on
async function cacheAllGroups(bot: Baileys) {
	const groupList = await bot.sock.groupFetchAllParticipating()

	let groups = Object.keys(groupList)

	groups.forEach(async (g) => {
		const group = await new Group(groupList[g]).checkData(bot)

		cache.groups.set(group.id, group)
	})

	print('CACHE', `${groups.length} groups cached`, 'blue')
	return
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
		return Object.keys(value!).length === 0 ||
			!Object.values(value!).some((item) => item !== undefined && item !== null)
	}

	return true
}

// isValidPositiveIntenger: validate a number
function isValidPositiveIntenger(value: num): bool {
	return !Number.isNaN(value) && value > 0 && Number.isInteger(value)
}

// genRandomName: Generate random names useful for temporary file names
function genRandomName(length: num = 20, prefix = '', suffix = ''): str {
	const characters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
	let result = ''

	for (let i = 0; i < length; i++) {
		const randomIndex = Math.floor(Math.random() * characters.length)
		result += characters.charAt(randomIndex) // gen random chars
	}

	return prefix + result + suffix // concatenate random str and preffix/suffix
}

// makeTempFile: Write a temporary file
async function makeTempFile(content: Buf | str, preffix?: str, suffix?: str) {
	const fileName = genRandomName(20, preffix, suffix) // generate random name
	const path = `${defaults.runner.tempFolder}/${fileName}`

	await writeFile(path, content) // create file

	return path
}

// cleanTemp: Clean temp folder
async function cleanTemp() {
	const temp = defaults.runner.tempFolder
	await mkdir(temp).catch(() => {})
	// create temp folder if it does not exists

	const files = await readdir(temp) // read folder

	files.forEach((f) => unlink(`${temp}/${f}`))
	// delete all files on it

	return
}
