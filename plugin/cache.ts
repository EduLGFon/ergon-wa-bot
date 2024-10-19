/** Cache manager:
 * It controls, limit and save
 * user/group cache.
 *
 * Cache saved on setings/cache/*.json
 */

import { readFile, writeFile } from 'fs/promises'
import { Baileys } from '../map.js'

type Cache = 'users' | 'groups'
const cachedData: Cache[] = ['users', 'groups']

export default class CacheManager {
	constructor(public bot: Baileys) {
		this.bot = bot

		this.resume()
		setInterval(() => this.save(), 10_000)
	}

	async save() {
		for (const category of cachedData) {
			const cache = JSON.stringify(this.bot[category].toJSON()) // converts data to String
			await writeFile(`settings/cache/${category}.json`, cache) // write cache
		}
		return
	}

	async resume() {
		for (const category of cachedData) {
			const cache = await readFile(`settings/cache/${category}.json`, { encoding: 'utf8' })
				.catch(() => {})
			// read file

			if (!cache) {
				print('CACHE', `No ${category} cache`, 'blue')
				continue
			}
			const json = JSON.parse(cache)
			// parse cache

			for (const [k, v] of Object.entries(json)) {
				this.bot[category].add(k, v!)
				// save it
			}
			print('CACHE', `${category} cache resumed`, 'blue')
		}
		return
	}
}
