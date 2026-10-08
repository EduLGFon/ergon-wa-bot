// Pinned profile card - WA pic plus about/desc mirrored into the topic.
//
// A new topic opens with the peer (or group) photo plus the about line as a
// pinned card, so the owner always sees who the topic is. Picture changes
// arrive as contacts.update events (Baileys emits imgUrl changed/removed for
// both DMs and groups); the relay calls syncProfileCard again, which unpins
// the old card, sends the fresh one and pins it. History is kept, only the
// pin moves. About text has no push event, so it is a snapshot taken at each
// card send (new topic plus picture changes).
//
// Privacy: pic URLs can carry tokens, so they are stored verbatim only in
// the local bridge DB (same trust level as reply_map content) and never
// logged. A hidden photo (401/404 from Baileys) degrades to a text-only card.
import { notifyTopic, relayCtx, shortErr, tgCall } from './state.ts'
import { isDual } from './routing.ts'
import { phoneOf } from './text.ts'
import { InlineKeyboard, InputFile } from 'grammy'
import bot from '@plugin/bot.ts'

// Profile photos are small - refuse anything abnormal before buffering it
// into the Telegram send.
const MAX_PIC_BYTES = 5 * 1024 * 1024

export interface ProfileCardInput {
	jid: string
	aliases?: string[]
	displayName: string
	chatType: '1:1' | 'group'
	isGroup: boolean
	topicId: number
	chatId: string
}

// Fetch the first successful profile picture URL across JID variants (LID
// vs PN addressing may differ per sighting). Returns null when hidden.
async function picUrlOf(jids: string[]): Promise<string | null> {
	for (const jid of [...new Set(jids.filter(Boolean))]) {
		try {
			const url = await (bot.sock as any)?.profilePictureUrl?.(jid, 'image')
			if (typeof url === 'string' && url.startsWith('https://')) return url
		} catch {
			// hidden or gone - try the next variant
		}
	}
	return null
}

// About/status text across JID variants. fetchStatus resolves to
// [{ id, status: { status, setAt } }] - null when hidden or empty.
async function aboutOf(jids: string[]): Promise<string | null> {
	for (const jid of [...new Set(jids.filter(Boolean))]) {
		try {
			const list = await (bot.sock as any)?.fetchStatus?.(jid)
			const rows = Array.isArray(list) ? list : []
			for (const row of rows) {
				const s = (row as any)?.status?.status ?? (row as any)?.status
				if (typeof s === 'string' && s.trim()) return s.trim().slice(0, 500)
			}
			if (rows.length > 0) return null
		} catch {
			// try the next variant
		}
	}
	return null
}

// Group description via metadata (no usync needed for groups).
async function groupDescOf(groupJid: string): Promise<string | null> {
	try {
		const meta = await bot.sock.groupMetadata(groupJid)
		const desc = (meta as any)?.desc
		if (typeof desc === 'string' && desc.trim()) return desc.trim().slice(0, 500)
	} catch {
		// metadata unreadable - text-only card without desc
	}
	return null
}

function buildCardText(
	displayName: string,
	phone: string,
	about: string | null,
	isGroup: boolean,
	hasPhoto: boolean,
): string {
	const who = isGroup ? `Group: ${displayName}` : displayName
	const contact = !isGroup && phone ? `\n${phone}` : ''
	const bio = about ? `\n${about}` : (hasPhoto ? '' : '\nNo bio visible')
	return `${who}${contact}${bio}`.slice(0, 1000)
}

// Personal/Business buttons riding on the profile card itself (see
// DECISIONS.md#D05). Button taps resolve the chat through the stored card
// message ID (callback payloads cap at 64 bytes).
export function classificationKeyboard(): InlineKeyboard {
	return new InlineKeyboard()
		.text('Personal', 'bucket:personal')
		.text('Business', 'bucket:business')
}

// Send and pin the profile card for a topic. Never throws: failures land as
// a topic notice or a server log, never break the message relay. Skips when
// nothing changed (same pic URL plus same about) unless forced.
export async function syncProfileCard(
	input: ProfileCardInput,
	opts: { force?: boolean } = {},
): Promise<void> {
	const { db, tg } = relayCtx
	if (!db || !tg) return
	const mapping = db.getByJidOrAlias(input.jid)
	if (!mapping || mapping.archived || mapping.muted) return
	if (mapping.telegram_topic_id !== input.topicId) return
	try {
		const jids = [input.jid, ...(input.aliases || [])]
		const [picUrl, about] = input.isGroup
			? [await picUrlOf([input.jid]), await groupDescOf(input.jid)]
			: await Promise.all([picUrlOf(jids), aboutOf(jids)])
		const prevPic = mapping.profile_pic_url ?? null
		const prevAbout = mapping.profile_about ?? null
		if (!opts.force && prevPic === picUrl && prevAbout === about && mapping.profile_msg_id) {
			return
		}
		const phone = !input.isGroup ? (phoneOf(input.jid) || '') : ''
		// Undecided chats in a dual-group setup carry the Personal/Business
		// buttons on the card itself - one message, one working button pair,
		// so the old duplicate-prompt race (two prompts, stale one answering
		// chat not found) cannot happen.
		const buttons = mapping.bucket === 'undecided' && isDual(relayCtx.groups)
			? { reply_markup: classificationKeyboard() }
			: undefined
		let picBytes: Uint8Array | null = null
		if (picUrl) {
			try {
				const res = await fetch(picUrl)
				if (res.ok) {
					const buf = new Uint8Array(await res.arrayBuffer())
					if (buf.length > 0 && buf.length <= MAX_PIC_BYTES) picBytes = buf
				}
			} catch {
				picBytes = null
			}
		}
		const caption = buildCardText(input.displayName, phone, about, input.isGroup, !!picBytes)
		const thread = { message_thread_id: input.topicId } as const
		const api = tg.api
		let msgId: number | null = null
		if (picBytes) {
			const file = new InputFile(picBytes, 'profile.jpg')
			const sent = await tgCall(
				() => api.sendPhoto(input.chatId, file, { ...thread, caption, ...buttons }),
				'profile-photo',
				input.chatId,
			).catch((e) => {
				console.error('[BRIDGE] profile photo send failed:', shortErr(e))
				return null
			})
			msgId = (sent as { message_id?: number } | null)?.message_id ?? null
		}
		if (msgId === null) {
			const sent = await tgCall(
				() => api.sendMessage(input.chatId, caption, { ...thread, ...buttons }),
				'profile-text',
				input.chatId,
			).catch((e) => {
				console.error('[BRIDGE] profile text send failed:', shortErr(e))
				return null
			})
			msgId = (sent as { message_id?: number } | null)?.message_id ?? null
		}
		if (msgId === null) return
		// Move the pin: unpin the previous card (kept as history), pin the
		// fresh one. Both best effort - pin rights may be missing.
		const prevMsgId = mapping.profile_msg_id
		if (prevMsgId && prevMsgId !== msgId) {
			await tgCall(
				() => api.unpinChatMessage(input.chatId, prevMsgId).catch(() => false),
				'unpin-profile',
				input.chatId,
			).catch(() => false)
		}
		await tgCall(
			() =>
				api.pinChatMessage(input.chatId, msgId!, { disable_notification: true }).catch(
					() => false,
				),
			'pin-profile',
			input.chatId,
		).catch(() => false)
		db.setProfile(input.jid, picUrl, about, msgId)
	} catch (e) {
		console.error('[BRIDGE] profile card sync failed:', e)
		await notifyTopic(
			input.chatId,
			input.topicId,
			`Could not load the profile photo: ${shortErr(e)}`,
		)
	}
}
