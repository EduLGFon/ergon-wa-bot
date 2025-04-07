import defaults from 'defaults' with { type: 'json' }
import Collection from 'class/collection.ts'
import User from 'class/user.ts'
import Cmd from 'class/cmd.ts'
// import Cmd from 'class/cmd.ts'

/** Cache manager:
 * It controls, limit and save
 * user/group cache.
 */
export default {
	users: new Collection(defaults.cache.users, User),
	groups: new Collection(defaults.cache.groups, User),
	cmds: new Collection<str, Cmd>(0, Cmd),
}
// const cachedData = ['users', 'groups']

// class CacheManager {
// 	// Collections (Stored data)
// 	cmds: Collection<str, Cmd>
// 	// users: Collection<num, User>
// 	// groups: Collection<str, Group>

// 	constructor() {
// 		// Cmds collection
// 		this.cmds = new Collection(0, Cmd, 'name')
// 		// Users collection
// 		// this.users = new Collection(100, User)
// 		// Groups collection
// 		// this.groups = new Collection(500, Group)
// 	}

// 	start() {
// 		this.resume()
// 		setInterval(() => this.save(), 60_000)
// 	}

// 	async save() {
// 		if (!Deno.readDirSync('conf/cache')) await Deno.mkdir('conf/cache')

// 		for (const category of cachedData) {
// 			const collection = this[category as 'cmds']
// 			const str = JSON.stringify(collection.toJSON()) // converts data to String
// 			await Deno.writeTextFile(`conf/cache/${category}.json`, str) // write cache
// 		}
// 		return
// 	}

// 	async resume() {
// 		for (const category of cachedData) {
// 			const cache = await Deno.readTextFile(`settings/cache/${category}.json`)
// 				.catch(() => {})
// 			// read file

// 			if (!cache) {
// 				console.log('CACHE', `No ${category} cache`, 'blue')
// 				continue
// 			}
// 			const json = JSON.parse(cache)
// 			// parse cache

// 			for (const [k, v] of Object.entries(json)) {
// 				// const place = this[category as '']
// 				// const value = await new place.base!(v).checkData(this.bot)

// 				// place.add(k, value)
// 				// save it
// 			}
// 			console.log('CACHE', `${category} cache resumed`, 'blue')
// 		}
// 		return
// 	}
// }

// const cache = new CacheManager()
// export default cache
