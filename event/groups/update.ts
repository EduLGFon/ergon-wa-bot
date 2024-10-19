import { Baileys } from '../../map.js'
import { GroupMetadata } from 'baileys'

// group update event
export default async function (bot: Baileys, groups: Partial<GroupMetadata>[]) {
	// fetch group metadata
	const g = await bot.sock.groupMetadata(groups[0].id!)
	// fetching is better than use this event args
	// bc it could be incomplete or partial

	// cache new group info
	bot.cache.groups.add(g.id, g)
	return
}
