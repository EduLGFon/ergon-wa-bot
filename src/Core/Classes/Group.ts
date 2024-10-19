import { GroupMetadata, GroupParticipant } from 'baileys';

export default class Group implements GroupMetadata {
	id: string;
	owner: string | undefined;
	subject: string;
	/** group subject owner */
	subjectOwner?: string;
	/** group subject modification date */
	subjectTime?: number;
	creation?: number;
	desc?: string;
	descOwner?: string;
	descId?: string;
	/** is set when the group only allows admins to change group settings */
	restrict?: boolean;
	/** is set when the group only allows admins to write messages */
	announce?: boolean;
	/** number of group participants */
	size?: number;
	participants: GroupParticipant[];
	ephemeralDuration?: number;
	inviteCode?: string;
	/** the person who added you */
	author?: string;

	constructor(id: string, subject: string, participants: GroupParticipant[]) {
		this.id = id;
		this.subject = subject;
		this.participants = participants;
	}
}
