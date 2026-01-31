import { getGroup } from '../../plugin/prisma.js'
import { ParticipantAction } from 'baileys'

/** group-participants.update:
 * This event will update members cache when a group member
 * is promoted or demoted on a group.
 */
export default async function (groupEvent: Event) {
	const group = await getGroup(groupEvent.id)
	if (!group) return
	const participant = groupEvent.participants[0]

	switch (groupEvent.action) {
		case 'promote': {
			const member = group.members.find((m) => m.id === participant)
			member!.admin = 'admin'
			return
		}
		case 'demote': {
			const member = group.members.find((m) => m.id === participant)
			member!.admin = null
			return
		}
		case 'add':
			group.members.push({ id: participant, admin: null })
			return
		case 'remove':
			group.members = group.members.filter((m) => m.id !== participant)
			return
	}
	return
}

interface Event {
	id: str
	author: str
	participants: str[]
	action: ParticipantAction
}
