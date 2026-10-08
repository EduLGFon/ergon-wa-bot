// Sync event: logs history-sync progress (contacts/chats backfill is intentionally a no-op).
import type { Chat, Contact, WAMessage } from 'baileys'

interface Event {
	chats: Chat[]
	contacts: Contact[]
	messages: WAMessage[]
	progress: num
	isLatest: boolean
}

export default function (data: Event, _e: str) {
	print('SYNC', `Syncing data: ${data.progress}%`, 'green')
}
