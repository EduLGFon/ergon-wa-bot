import { ParticipantAction } from 'baileys'
import bot from '../../wa.js'

/** group-participants.update:
 * This event will update members cache when a group member
 * is promoted or demoted on a group.
 */
export default async function (groupEvent: Event) {
	if (!['promote', 'demote'].includes(groupEvent.action)) return
	const group = await bot.getGroup(groupEvent.id)

	if (!group) return

	const member = group.members.find((m) => m.id === groupEvent.author)
	if (!member) return

	const actions: { demote: null; promote: 'admin' } = {
		demote: null,
		promote: 'admin',
	}

	// update cache
	member.admin = actions[groupEvent.action as 'demote']
}

interface Event {
	id: str
	author: str
	participants: str[]
	action: ParticipantAction
}
