import type { Chat, Contact, WAMessage } from 'baileys'
// import { getUser } from '../../util/prisma.ts'
// import { appendFile } from 'fs/promises'

interface Event {
	chats: Chat[]
	contacts: Contact[]
	messages: WAMessage[]
	progress: num
	isLatest: boolean
}

export default async function (data: Event, e: str) {
	// const { chats, contacts, messages, isLatest, progress } = data
	print('SYNC', `Syncing data: ${data.progress}%`, 'green')

	// for (const c of data.contacts) {
	// 	let name = c.notify || c.name || c.verifiedName

	// 	if (!name) continue
	// 	if (!c.id.includes('@s.whatsapp.net')) continue

	// 	await getUser({ phone: c.id, name })
	// }

	// await appendFile('history.json', ', ' + JSON.stringify(data))
}
