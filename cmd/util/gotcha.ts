import {
	type DeletedEntry,
	fetchMissingMedia,
	listDeleted,
	readDeletedMedia,
} from '@plugin/deletedStore.ts'
import { isValidPositiveIntenger, randomDelay } from '@util/functions.ts'
import { type CmdCtx } from '@conf/types/types.d.ts'
import { type AnyMessageContent } from 'baileys'
import { getGroup, getUser } from '@db'
import cache from '@plugin/cache.ts'
import Cmd from '@class/cmd.ts'

export default class extends Cmd {
	constructor() {
		super({
			alias: [],
			access: { restrict: true },
		})
	}

	async run({ msg, args, user, send, react, startTyping, t }: CmdCtx) {
		const parsed = [...args]
		let limit = 5
		const last = parsed[parsed.length - 1]
		if (last && /^\d+$/.test(last)) {
			limit = Number(parsed.pop())
			if (!isValidPositiveIntenger(limit)) return send('usage.gotcha', { user })
		}

		const spec = parsed.join(' ').trim()
		const target = await this.resolveTarget(spec, msg.chat)
		if (!target) return send(t('gotcha.noTarget'), { quoted: msg })
		if ('candidates' in target) {
			return send(t('gotcha.multi', { list: target.candidates }), { quoted: msg })
		}

		await startTyping()
		const entries = await this.collectEntries(target.chatIds, limit)
		if (!entries.length) return send(t('gotcha.empty'), { quoted: msg })

		await react('loading').catch(() => {})
		await this.sendTexts(entries, target.label, send, msg, t)
		await this.sendMedia(entries, send, msg, t)
	}

	// Resolve a user spec to one or more chat ids holding deleted history.
	private async resolveTarget(
		spec: str,
		current: str,
	): Promise<{ chatIds: str[]; label: str } | { candidates: str } | null> {
		if (!spec) return { chatIds: [current], label: current }

		// Direct JID (group invite id, lid or full JID).
		if (spec.includes('@')) {
			const id = spec.trim()
			if (id.includes('@g.us')) {
				const group = await getGroup(id).catch(() => null)
				if (!group) return null
				return { chatIds: [group.id], label: group.name || group.id }
			}
			const user = await getUser({ lid: id }).catch(() => null)
			if (!user) return null
			return { chatIds: this.dmIds(user.lid, user.phone), label: user.name || user.phone }
		}

		const digits = spec.replace(/[^0-9]/g, '')
		if (digits.length >= 8) {
			// Phone number or lid digits: match cached users first.
			const user = cache.users.find((u) =>
				u.phone === digits || u.lid.parsePhone() === digits || u.lid === spec.trim()
			)
			if (user) return { chatIds: this.dmIds(user.lid, user.phone), label: user.name }
			// No '@' here (direct JIDs return earlier), so it can only be a lid.
			const dbUser = await getUser({ lid: `${digits}@lid` }).catch(() => null)
			if (dbUser) return { chatIds: this.dmIds(dbUser.lid, dbUser.phone), label: dbUser.name }
			return null
		}

		// Name search across groups and users.
		const q = spec.toLowerCase()
		const groupHits = cache.groups.filter((g) => g.name?.toLowerCase().includes(q))
		const userHits = cache.users.filter((u) => u.name?.toLowerCase().includes(q))
		if (groupHits.length === 1 && !userHits.length) {
			return { chatIds: [groupHits[0].id], label: groupHits[0].name }
		}
		if (userHits.length === 1 && !groupHits.length) {
			return {
				chatIds: this.dmIds(userHits[0].lid, userHits[0].phone),
				label: userHits[0].name,
			}
		}
		if (!groupHits.length && !userHits.length) return null

		const lines = [
			...groupHits.slice(0, 10).map((g) => `- ${g.name} (${g.id})`),
			...userHits.slice(0, 10).map((u) => `- ${u.name} (${u.lid} / ${u.phone})`),
		]
		return { candidates: lines.join('\n') }
	}

	// A DM may be stored under the @lid id or the @s.whatsapp.net phone id.
	private dmIds(lid: str, phone: str): str[] {
		const ids = [lid]
		const pn = `${phone}@s.whatsapp.net`
		if (!ids.includes(pn)) ids.push(pn)
		return ids
	}

	// Merge entries from all candidate chat ids, oldest first.
	private async collectEntries(chatIds: str[], limit: num): Promise<DeletedEntry[]> {
		const all: DeletedEntry[] = []
		for (const id of chatIds) all.push(...await listDeleted(id, 0))
		all.sort((a, b) => a.ts - b.ts)
		return all.slice(-limit)
	}

	// Send all text deletes as one grouped message (consecutive same-author merged).
	private async sendTexts(
		entries: DeletedEntry[],
		label: str,
		send: CmdCtx['send'],
		msg: CmdCtx['msg'],
		t: CmdCtx['t'],
	) {
		const blocks: str[] = []
		let current: { author: str; lines: str[] } | null = null
		const flush = () => {
			if (current) blocks.push(`*${current.author}:*\n${current.lines.join('\n')}`)
			current = null
		}

		for (const e of entries) {
			const hasMedia = !!e.mediaFile
			const text = (e.text || '').trim()
			if (hasMedia && !text) continue // media sent separately
			const line = text || (e.unavailable ? t('gotcha.unavailable') : t('gotcha.noText'))
			const when = new Date(e.ts).toLocaleString()
			const row = `- ${line} (${when})`
			if (current && current.author === e.authorName) current.lines.push(row)
			else {
				flush()
				current = { author: e.authorName, lines: [row] }
			}
		}
		flush()
		if (!blocks.length) return

		await send(
			t('gotcha.header', { chat: label, count: entries.length }) + '\n\n' +
				blocks.join('\n\n'),
			{
				quoted: msg,
			},
		)
	}

	// Re-send stored media deletes one by one with author captions.
	// When the buffer is missing from disk (evicted, never downloaded),
	// retry the download from WhatsApp servers with the persisted keys.
	private async sendMedia(
		entries: DeletedEntry[],
		send: CmdCtx['send'],
		msg: CmdCtx['msg'],
		t: CmdCtx['t'],
	) {
		for (const e of entries) {
			if (!e.mediaFile && !e.mediaUrl) continue // placeholder already shown in text phase
			let buffer = e.mediaFile ? await readDeletedMedia(e.chat, e).catch(() => null) : null
			if (!buffer) buffer = await fetchMissingMedia(e)
			if (!buffer) {
				await send(t('gotcha.expired', { author: e.authorName }), { quoted: msg })
				continue
			}

			const caption = `*${e.authorName}* (${new Date(e.ts).toLocaleString()})` +
				(e.text ? `\n${e.text}` : '')
			await send(this.toMediaContent(e.type, buffer, e.mediaMime || e.mime, caption), {
				quoted: msg,
			})
			await randomDelay(500, 1_500)
		}
	}

	// Map a stored type to a Baileys payload (stickers go back as stickers).
	private toMediaContent(type: str, buffer: Buf, mime: str, caption: str): AnyMessageContent {
		if (type === 'image') return { image: buffer, caption } as AnyMessageContent
		if (type === 'video') return { video: buffer, caption } as AnyMessageContent
		if (type === 'audio') return { audio: buffer, mimetype: mime } as AnyMessageContent
		if (type === 'sticker') return { sticker: buffer } as AnyMessageContent
		if (type === 'document') {
			return {
				document: buffer,
				mimetype: mime,
				fileName: 'gotcha-file',
			} as AnyMessageContent
		}
		return { image: buffer, caption } as AnyMessageContent
	}
}
