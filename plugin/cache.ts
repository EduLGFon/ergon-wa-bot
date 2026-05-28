import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { Cmd, Collection, defaults, Group, User } from '../map.ts'
import { existsSync } from 'node:fs'

/** Cache manager:
 * It controls, limit and save
 * user/group cache.
 *
 * Cache saved on conf/gen/cache/*.json
 */
const cachedData: ('media' | 'metrics')[] = ['metrics', 'media']

class CacheManager {
	// Collections (Stored data)
	cmds: Collection<str, Cmd>
	wait: Collection<str, Func>
	users: Collection<num, User>
	events: Map<str, Func>
	media: Collection<str, Media>
	groups: Collection<str, Group>
	metrics: { msg: any; cmd: any }
	timeouts: Map<str, NodeJS.Timeout>

	constructor() {
		// wait: arbitrary functions that can be called on events
		this.wait = new Collection(0)
		// Events collection (0 means no limit)
		this.events = new Map()
		// Cmds collection
		this.cmds = new Collection(0, 'name')
		// Users collection
		this.users = new Collection(defaults.cache.users)
		// Media collection
		// It stores media data like images, videos, etc.
		// It uses URL as key to avoid duplicates
		this.media = new Collection(100, 'url')
		// Groups collection
		this.groups = new Collection(100)
		// Metrics
		this.metrics = { msg: {}, cmd: {} }
		// Timeouts
		this.timeouts = new Map()
	}

	async save() {
		if (!existsSync('conf/gen/cache')) await mkdir('conf/gen/cache')

		for (const cat of cachedData) {
			// @ts-ignore just ignore toJson doesn't exist on all possible types
			const json = this[cat].toJSON ? this[cat].toJSON() : this[cat]
			await writeFile(`conf/gen/cache/${cat}.json`, JSON.stringify(json)) // write cache
		}
		print('CACHE', 'Metrics and media saved', 'yellow')
	}

	async resume() {
		for (const cat of cachedData) {
			// if --rm-cache is passed, remove cache files
			if (process.argv.includes('--rm-cache')) {
				await unlink(`conf/gen/cache/${cat}.json`)
				// remove cache files

				print('CACHE', `Removing ${cat} cache`, 'blue')
				continue
			}

			const cache = await readFile(`conf/gen/cache/${cat}.json`, {
				encoding: 'utf8',
			}).catch(() => {})
			// read file

			if (!cache) {
				print('CACHE', `No ${cat} cache`, 'blue')
				continue
			}
			const json = JSON.parse(cache)
			// parse cache

			for (const [k, v] of Object.entries(json)) {
				const collection = this[cat]

				// @ts-ignore ignore isCollection checking
				if (collection?.add) {
					;(collection as Collection<any, any>).add(k, v)
				} else
					(
						collection as {
							msg: any
							cmd: any
						}
					)[k as 'msg'] = v
			}
			print('CACHE', `${cat} cache resumed`, 'blue')
		}
	}
}

const cache = new CacheManager()
export default cache

export async function cleanTemp() {
	const files = await readdir('conf/gen/temp')
	let i = 0
	for (const f of files) {
		if (f === 'disclaimer.txt') continue

		await unlink(`conf/gen/temp/${f}`)
		i++
	}
	print('TEMP', `${i} temp files cleaned`, 'blue')
}
