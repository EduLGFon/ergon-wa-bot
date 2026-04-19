import { getMedia, reactToMsg, sendMsg } from '../util/messages.js'
import { randomDelay } from '../util/functions.js'
import { Group, Msg, User } from '../map.js'
import { AnyMessageContent } from 'baileys'
type Announcement = { text?: str; caption?: str; groups?: str[]; tag?: str; msg?: Msg }
// Announcement = simple text msg or media msg (replace text by caption)

/** How does this shit work?
 * every new msg will be pushed to the end of the queue.
 * bot will send the FIRST msg to all chats
 * then it shifts the array (removes the first element and goes to the next)
 * until it's empty.
 * when the bot start to send a msg, isSending will be true until
 * it cleans the entire queue.
 * It prevents calling sendAnnouncements() twice
 * while bot is still sending the msgs.
 * a risky way to live for sure cuz it would be really
 * chaottic if sendAnnouncement() got called two times in a row
 */

let isSending = false
const msgQueue: Announcement[] = []
const allowedTags = {
	'#diurno': process.env.GROUPS1!.split('|'),
	'#noturno': process.env.GROUPS2!.split('|'),
	'#todos': [''],
}
allowedTags['#todos'] = [...allowedTags['#diurno'], ...allowedTags['#noturno']]

export { allowedTags }
export default checkGroupAnnouncer
async function checkGroupAnnouncer(msg: Msg, user: User, group?: Group) {
	if (!group || !allowedTags['#todos'].includes(group.id) || msg.isBot) return
	// ignore msgs from DMs, from other groups or that was sent by the bot

	let announceMsg: Announcement = {}
	const lowText = msg.text.toLowerCase()
	for (const [key, value] of Object.entries(allowedTags)) {
		if (lowText.includes(key))
			announceMsg = {
				tag: key, // tag trigger
				groups: value.filter(g => g !== group.id),
				// all groups that wasn't the group the msg was sent
			}
	}

	// ignore msgs that not contain any tag
	if (!announceMsg.tag) return
	// ignore msgs equals to just '#todos'
	if (lowText === announceMsg.tag && !msg.media && !msg.quoted?.media) {
		randomDelay(500, 1_500).then(() => reactToMsg.bind(msg)('question'))
		// ignore no empty content msgs (only tag msgs)
		return
	}

	announceMsg.text = `*${user.name}:* ${msg.text}`
	if (msg.quoted) {
		announceMsg.text = `> ${msg.quoted.text}\n${announceMsg.text}`
	}

	if (msg.media || msg.quoted?.media) {
		const media = await getMedia(msg)
		const type = msg.media ? msg.type : msg.quoted?.type!
		announceMsg = {
			caption: announceMsg.text,
			[type]: media!.buffer,
			groups: announceMsg.groups,
		}
	}

	announceMsg.msg = msg
	msgQueue.push(announceMsg)
	// push the announcement to the end of the queue

	if (!isSending) sendAnnouncements()
	// only calls sendAnnouncements() if it's not doing anything
}

async function sendAnnouncements() {
	if (!msgQueue[0]) return // there's no more msgs to send
	// if (isSending === true) return // containment measure to stop the hell
	isSending = true // now, sendAnnouncements() won't be called again
	// until the queue is empty

	const msg = msgQueue[0].msg!
	// it is important bc msgQueue[0] will be deleted soon
	randomDelay().then(() => reactToMsg.bind(msg)('ok'))

	for (const g of msgQueue[0].groups!) {
		await randomDelay(1_000, 2_500)
		// a random delay is required to Meta not flag us as
		// a spam bot. random delays and different msgs looks
		//  like real users
		await sendMsg.bind(g)(msgQueue[0] as AnyMessageContent)
	}

	msgQueue.shift() // removes the first element
	// and goes to the next if it exists
	if (msgQueue[0]) sendAnnouncements()
	else isSending = false
	// if not, all the work has been done
}
