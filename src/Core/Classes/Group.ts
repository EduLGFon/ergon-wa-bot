import { GroupMetadata, GroupParticipant } from 'baileys';
import pg from '../Components/PostgreSQL.js';
import { GroupMsg } from '../Typings/types.js';

export default class Group {
	id: str;
	owner?: str;
	name: str;
	/** group subject modification date */
	nameTimestamp?: num;
	creation?: num;
	desc?: str;
	/** is set when the group only allows admins to change group settings */
	restrict?: bool;
	/** is set when the group only allows admins to write messages */
	announce?: bool;
	/** number of group participants */
	size?: num;
	members: GroupParticipant[];
	ephemeral?: num;
	invite?: str;
	/** the person who added you */
	author?: str;

	constructor(g: GroupMetadata) {
		this.id = g.id;
		this.name = g.subject;
		this.owner = g.owner;
		this.nameTimestamp = g.subjectTime;
		this.creation = g.creation;
		this.desc = g.desc;
		this.restrict = g.restrict;
		this.announce = g.announce;
		this.size = g.size;
		this.members = g.participants;
		this.ephemeral = g.ephemeralDuration;
		this.invite = g.inviteCode;
		this.author = g.author;
	}

	async addMsg(author: str) {
		const id = `${author}|${this.id}`;
		let userCounter = await pg.msgs.find({ id }) as GroupMsg;

		if (!userCounter) {
			userCounter = await pg.msgs.create({
				id,
				data: {
					count: 1,
				},
			}) as GroupMsg;
		}

		await pg.msgs.update({
			id,
			data: {
				count: userCounter.count + 1,
			},
		});
		return;
	}

	async getMsgs(author?: str) {
		if (author) {
			return await pg.msgs.find({
				id: `${author}|${this.id}`,
			});
		}

		return (await pg.msgs.getAll()).filter((m) => m.author.includes(this.id));
	}

	async checkData() {
		let data = await pg.groups.find({ id: this.id });

		if (!data) {
			data = await pg.groups.create({ id: this.id });
		}

		return this;
	}
}
