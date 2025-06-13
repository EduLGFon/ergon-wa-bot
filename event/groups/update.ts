import { GroupMetadata } from 'baileys'
import cache from '../../plugin/cache.js'
import bot from '../../wa.js'

// group update event
export default async function (groups: Partial<GroupMetadata>[]) {
	for (const g of groups) {
		if (!g.id) continue

		cache.groups.delete(g.id) // delete group cache
		await bot.getGroup(g.id) // create a new one
		// it fetchs group metadata
		// fetching is better than use this event args
		// bc it could be incomplete or partial
	}
	return
}
