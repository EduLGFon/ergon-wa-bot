import { GroupMetadata, GroupParticipant, proto } from 'baileys';
import prisma from '../Components/Prisma.js';
import Message from './Message.js';
import Collection from '../Plugins/Collection.js';
import { Msg } from '../Typings/types.js';

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
	cachedMsgs: Collection<string, Message>;

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
		this.cachedMsgs = new Collection({}, 100);
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

	getCachedMsgs (limit?: number): Message[] {
		const arrayMsgs = this.cachedMsgs.reduce(
			(array: Message[], msg: Message) => array.push(msg), []
		).reverse();
		
		if (limit) arrayMsgs.length = limit;
	
		return arrayMsgs;
	}

	cacheMsg (msg: Msg) {
		return this.cachedMsgs.set(msg.key.id as string, new Message(msg));
	}

	async checkData() {
		return this;
	}
}
