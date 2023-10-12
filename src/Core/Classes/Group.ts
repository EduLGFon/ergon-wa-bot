import { GroupMetadata, GroupParticipant } from 'baileys';

// this file only exists for a Collection base class

export default class Group implements GroupMetadata {
	id: str;
	owner: str | undefined;
	subject: str;
	/** group subject owner */
	subjectOwner?: str;
	/** group subject modification date */
	subjectTime?: num;
	creation?: num;
	desc?: str;
	descOwner?: str;
	descId?: str;
	/** is set when the group only allows admins to change group settings */
	restrict?: bool;
	/** is set when the group only allows admins to write messages */
	announce?: bool;
	/** number of group participants */
	size?: num;
	participants: GroupParticipant[];
	ephemeralDuration?: num;
	inviteCode?: str;
	/** the person who added you */
	author?: str;

	constructor(id: str, subject: str, participants: GroupParticipant[]) {
		this.id = id;
		this.subject = subject;
		this.participants = participants;
	}
}
