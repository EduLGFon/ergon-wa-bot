import { GroupMetadata, GroupParticipant } from 'baileys';
import pg from '../Components/PostgreSQL.js';

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
	}

	async getMsgs() {
		return await pg.groups.getAll({
			orderBy: {
				key: 'count',
				type: 'DESC',
			},
		});
	}

	async checkData() {
		let data = await pg.groups.find({ id: this.id });

		if (!data) data = await pg.groups.create({ id: this.id });

		return this;
	}
}
