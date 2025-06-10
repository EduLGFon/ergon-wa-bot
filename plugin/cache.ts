/** Cache manager:
 * It controls, limit and save
 * user/group cache.
 *
 * Cache saved on setings/cache/*.json
 */

import { Baileys, Cmd, Collection, Group, User } from '../map.js'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'

const cachedData = ['users', 'groups']

export default class CacheManager {
	// Collections (Stored data)
	cmds: Collection<str, Cmd>
	wait: Collection<str, Func>
	users: Collection<num, User>
	events: Collection<str, Func>
	groups: Collection<str, Group>
	timeouts: Collection<str, NodeJS.Timeout>

	constructor(public bot: Baileys) {
		this.bot = bot
		// wait: arbitrary functions that can be called on events
		this.wait = new Collection(0)
		// Events collection (0 means no limit)
		this.events = new Collection(0, null, 'name')
		// Cmds collection
		this.cmds = new Collection(0, Cmd, 'name')
		// Users collection
		this.users = new Collection(100, User)
		// Groups collection
		this.groups = new Collection(500, Group)
		// Timeouts
		this.timeouts = new Collection(0)
	}

	start() {
		this.resume()
		setInterval(() => this.save(), 60_000)
	}

	async save() {
		if (!existsSync('conf/cache')) await mkdir('conf/cache')

		for (const category of cachedData) {
			const collection = this[category as 'cmds']
			const str = JSON.stringify(collection.toJSON()) // converts data to String
			await writeFile(`conf/cache/${category}.json`, str) // write cache
		}
		return
	}

	async resume() {
		for (const category of cachedData) {
			const cache = await readFile(`conf/cache/${category}.json`, { encoding: 'utf8' })
				.catch(() => {})
			// read file

			if (!cache) {
				print('CACHE', `No ${category} cache`, 'blue')
				continue
			}
			const json = JSON.parse(cache)
			// parse cache

			for (const [k, v] of Object.entries(json)) {
				const place = this[category as 'groups']
				// @ts-ignore
				const value = await new place.base!(v).checkData(this.bot)

				place.add(k, value)
				// save it
			}
			print('CACHE', `${category} cache resumed`, 'blue')
		}
		return
	}
}
