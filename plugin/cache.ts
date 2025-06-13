/** Cache manager:
 * It controls, limit and save
 * user/group cache.
 *
 * Cache saved on setings/cache/*.json
 */

import { mkdir, readFile, unlink, writeFile } from 'fs/promises'
import { Cmd, Collection, Group, User } from '../map.js'
import { existsSync } from 'fs'

const cachedData = ['users', 'groups']

class CacheManager {
	// Collections (Stored data)
	cmds: Collection<str, Cmd>
	wait: Collection<str, Func>
	users: Collection<num, User>
	events: Map<str, Func>
	groups: Map<str, Group>
	timeouts: Map<str, NodeJS.Timeout>

	constructor() {
		// wait: arbitrary functions that can be called on events
		this.wait = new Collection(0)
		// Events collection (0 means no limit)
		this.events = new Map()
		// Cmds collection
		this.cmds = new Collection(0, 'name')
		// Users collection
		this.users = new Collection(100)
		// Groups collection
		this.groups = new Map()
		// Timeouts
		this.timeouts = new Map()
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
			// if --rm-cache is passed, remove cache files
			if (process.argv.includes('--rm-cache')) {
				await unlink(`conf/cache/${category}.json`)
				// remove cache files

				print('CACHE', `No ${category} cache`, 'blue')
				continue
			}

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

				place.set(k, value)
				// save it
			}
			print('CACHE', `${category} cache resumed`, 'blue')
		}
		return
	}
}

const cache = new CacheManager()
cache.resume()
export default cache
