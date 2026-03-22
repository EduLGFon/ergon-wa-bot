import { randomDelay } from '../../util/functions.js'
import { getGroup } from '../../plugin/prisma.js'
import cache from '../../plugin/cache.js'
import { GroupMetadata } from 'baileys'

// group update event
export default async function (groups: Partial<GroupMetadata>[]) {
	for (const g of groups) {
		if (!g.id) continue

		cache.groups.delete(g.id) // delete group cache
		await getGroup(g.id) // create a new one
		// it fetchs group metadata
		// fetching is better than use this event args
		// bc it could be incomplete or partial
		await randomDelay()
	}
}
