import { getMedia, sendMsg } from '../util/messages.js'
import { randomDelay } from '../util/functions.js'
import { Group, Msg, User } from '../map.js'
import { AnyMessageContent } from 'baileys'
type Announcement = { text: str; chats: str[] } | { caption: str; chats: str[] }
// simple text msg | media msg

let isSending = false
const msgQueue: Announcement[] = []
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

export default checkGroupAnnouncer
async function checkGroupAnnouncer(msg: Msg, user: User, group?: Group) {
	if (!msg.text.toLowerCase().includes('#todos') || msg.isBot) return
	// ignore msgs that not contain '#todos' or was sent by the bot
	if (!group || !process.env.ANNOUNCER!.includes(group.id)) return
	// ignore msgs from DMs or other groups

	let announceMsg: Announcement = {
		// simple text msg
		text: `[${group.name}]\n*${user.name}:* ${msg.text}`,
		chats: [], // all chats to send the msg
	}

	if (msg.media) {
		const media = await getMedia(msg)
		announceMsg = {
			caption: announceMsg.text,
			[msg.type]: media!.buffer,
			chats: [],
		}
	}

	announceMsg.chats = process.env.ANNOUNCER!.split('|').filter(g => g !== group.id)
	// all chats to send the msg, except the chat in which the msg was sent.
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

	for (const g of msgQueue[0].chats) {
		await randomDelay()
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
