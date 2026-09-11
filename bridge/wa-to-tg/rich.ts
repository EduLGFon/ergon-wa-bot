// Rich WA types as text - human notices for types with no native mapping.
//
// Contacts, invites, events, scheduled calls, sticker packs and call logs
// have no Telegram endpoint - this renders them as readable text so the
// topic shows WHAT arrived instead of the unsupported line. Returns null for
// anything unhandled (which keeps falling through to that notice) and for
// call logs that duplicate a just-relayed live call (see calls.ts).
import { wasCallClosedRecently } from './calls.ts'
import { WA_ENVELOPE_KEYS } from './unsupported.ts'
import { parseVcard } from '../format.ts'
import { truncateOneLine } from './unsupported-preview.ts'
import { unwrap } from './text.ts'
import type { proto } from 'baileys'

const MAX_LISTED_CONTACTS = 10

function contactLine(c: any): string | null {
	if (!c || typeof c !== 'object') return null
	const { name, phone } = parseVcard(typeof c.vcard === 'string' ? c.vcard : null)
	const label = String(c.displayName || name || '').trim() || 'Contact'
	return `👤 ${label}${phone ? ` (${phone})` : ''}`
}

function str(node: any, keys: string[]): string | null {
	if (!node || typeof node !== 'object') return null
	for (const k of keys) {
		const v = node[k]
		if (typeof v === 'string' && v.trim()) return v.trim()
	}
	return null
}

// Readable text notice for a rich WA message, or null when the type has no
// notice (falls through to unsupported) or needs no line at all (a call log
// duplicating the live call notice posted seconds ago).
export function getRichNotice(
	message: proto.IMessage | undefined | null,
	jid: string,
): string | null {
	try {
		const raw = unwrap(message)
		if (!raw || typeof raw !== 'object') return null
		const keys = Object.keys(raw).filter((k) => !WA_ENVELOPE_KEYS.has(k))
		const primary = keys[0]
		if (!primary) return null
		const node = raw[primary]
		if (!node || typeof node !== 'object') return null
		switch (primary) {
			case 'contactsArrayMessage': {
				const list = Array.isArray(node.contacts) ? node.contacts : []
				if (list.length === 0) return null
				const lines = list.slice(0, MAX_LISTED_CONTACTS).map(contactLine).filter(Boolean)
				if (lines.length === 0) return null
				const head = `👥 ${list.length} contact${list.length === 1 ? '' : 's'}`
				const more = list.length > lines.length
					? `\n…and ${list.length - lines.length} more`
					: ''
				return `${head}\n${(lines as string[]).join('\n')}${more}`
			}
			case 'groupInviteMessage': {
				const name = str(node, ['groupName'])
				const code = str(node, ['inviteCode'])
				if (!name && !code) return null
				return `📩 Group invite${name ? `: ${name}` : ''}${code ? ` (code: ${code})` : ''}`
			}
			case 'eventMessage': {
				const name = str(node, ['name'])
				const desc = truncateOneLine(str(node, ['description']), 200)
				const loc = str(node, ['location'])
				if (!name && !desc && !loc) return null
				return `📅 Event: ${name || 'Event'}${loc ? ` @ ${loc}` : ''}${
					desc ? `\n${desc}` : ''
				}`
			}
			case 'eventResponseMessage': {
				const name = str(node, ['eventName'])
				const resp = truncateOneLine(
					typeof node.response === 'string' ? node.response : null,
					120,
				)
				if (!name && !resp) return null
				return `📅 ${name || 'Event'}: ${resp || 'responded'}`
			}
			case 'scheduledCallCreationMessage':
			case 'scheduledCallEditMessage': {
				const name = str(node, ['scheduledCallName', 'title'])
				return name ? `📞 Scheduled call: ${name}` : '📞 Scheduled call'
			}
			case 'stickerPackMessage': {
				const name = str(node, ['name'])
				return name ? `🎨 Sticker pack: ${name}` : '🎨 Sticker pack'
			}
			case 'callLogMessage': {
				// Live signaling already posted this call seconds ago.
				if (jid && wasCallClosedRecently(jid)) return null
				const name = str(node, ['displayName'])
				const dur = typeof node.duration === 'number' && node.duration > 0
					? ` (${node.duration}s)`
					: ''
				return `📞 Call${name ? ` with ${name}` : ''}${dur}`
			}
			default:
				return null
		}
	} catch {
		return null
	}
}
