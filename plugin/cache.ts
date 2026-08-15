import defaults from '@conf/defaults.json' with { type: 'json' }
import Collection from '@class/collection.ts'
import Group from '@class/group.ts'
import User from '@class/user.ts'
import Cmd from '@class/cmd.ts'

/** Cache manager:
 * It controls, limit and save
 * user/group cache.
 *
 * Cache saved on conf/gen/cache/*.json
 */
const cachedData: ('metrics')[] = ['metrics']

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
		await Deno.mkdir('conf/gen/cache', { recursive: true })

		for (const cat of cachedData) {
			const collection = this[cat] as any
			const json = collection.toJSON ? collection.toJSON() : collection
			await Deno.writeTextFile(`conf/gen/cache/${cat}.json`, JSON.stringify(json)) // write cache
		}
		print('CACHE', 'Metrics saved', 'yellow')
	}

	async resume() {
		for (const cat of cachedData) {
			// if --rm-cache is passed, remove cache files
			if (Deno.args.includes('--rm-cache')) {
				await Deno.remove(`conf/gen/cache/${cat}.json`)
				// remove cache files

				print('CACHE', `Removing ${cat} cache`, 'blue')
				continue
			}

			const cache = await Deno.readTextFile(`conf/gen/cache/${cat}.json`).catch(() => null)
			// read file

			if (!cache) {
				print('CACHE', `No ${cat} cache`, 'blue')
				continue
			}
			const json = JSON.parse(cache, (_key, value) => {
				if (
					value !== null && typeof value === 'object' && value.type === 'Buffer' &&
					Array.isArray(value.data)
				) {
					return Buffer.from(value.data)
				}
				return value
			})
			// parse cache

			for (const [k, v] of Object.entries(json)) {
				const collection = this[cat] as any

				if (collection?.add) {
					;(collection as Collection<any, any>).add(k, v)
				} else {
					collection[k] = v
				}
			}
			print('CACHE', `${cat} cache resumed`, 'blue')
		}
	}
}

const cache = new CacheManager()
export default cache
