import Bot from '../../Core/Classes/Bot.js';
import { GroupMetadata } from 'baileys';

export default async function (this: Bot, groups: Partial<GroupMetadata>[]) {
	// fetch group metadata
	const g = await this.sock.groupMetadata(groups[0].id!);
	// fetching is better than use this event parameter
	// bc it could be incomplete

	// save new group info
	this.groups.set(g.id, g);
}
