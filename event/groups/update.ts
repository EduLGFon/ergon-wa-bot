// Groups update - refresh group cache on subject change
// Deletes cached group and refetches fresh metadata
// Partial event args are skipped in favor of full fetch
import { randomDelay } from '@util/functions.ts'
import { dropGroupMetaCache } from '@class/groupMeta.ts'
import { type GroupMetadata } from 'baileys'
import cache from '@plugin/cache.ts'
import { getGroup } from '@db'

// group update event
export default async function (groups: Partial<GroupMetadata>[]) {
	for (const g of groups) {
		if (!g.id) continue

		cache.groups.delete(g.id) // delete group cache
		dropGroupMetaCache(g.id) // drop shared metadata so next send refetches
		await getGroup(g.id) // create a new one
		// it fetchs group metadata
		// fetching is better than use this event args
		// bc it could be incomplete or partial
		await randomDelay()
	}
}
