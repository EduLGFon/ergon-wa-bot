import { GroupMetadata, GroupParticipant } from 'baileys';
import prisma from '../Components/Prisma.js';

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
		await prisma.msgs.upsert({
			where: {
				author_group: {
					author,
					group: this.id,
				},
			},
			create: {
				author,
				group: this.id,
				count: 1,
			},
			update: {
				count: { increment: 1 },
			},
		});
		return;
	}

	async getMsgs(author?: str) {
		if (author) {
			return await prisma.msgs.findUnique({
				where: {
					author_group: {
						author,
						group: this.id,
					},
				},
			});
		}

		const msgs = await prisma.msgs.findMany({
			where: {
				group: this.id,
			},
		});

		return msgs;
	}

	async checkData() {
		return this;
	}
}
