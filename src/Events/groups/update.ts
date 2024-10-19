import { GroupMetadata } from 'baileys';
import Bot from '../../Core/Bot';

export default async function (this: Bot, groups: Partial<GroupMetadata>[]) {
	//fetch group metadata
	const g = await this.sock.groupMetadata(groups[0].id!);
	// fetching is better than use this event parameter
	// bc this one could be incomplete

	// save new group info
	this.groups.set(g.id, g);
}
