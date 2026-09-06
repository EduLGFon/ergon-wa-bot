// Telegram → WhatsApp relay.
//
// Sends through the SHARED WhatsApp socket (bot.sock singleton), so there is
// only ever one WhatsApp connection. Text, captions, media and Telegram
// replies (→ WhatsApp quoted replies) are supported.
import { Bot } from 'grammy'
import bot from '@plugin/bot.ts'
import type { BridgeDB } from './db.ts'
import type { RateLimiter } from './rate-limiter.ts'

export function registerTgHandlers(tg: Bot, db: BridgeDB, limiter: RateLimiter): void {
	const supergroupId = String(Deno.env.get('TELEGRAM_SUPERGROUP_ID'))

	tg.command('start', async (ctx) => {
		await ctx.reply('WhatsApp bridge is active. Each WhatsApp chat mirrors to its own topic.')
	})

	tg.command('id', async (ctx) => {
		await ctx.reply(
			`Supergroup ID: \`${ctx.chat.id}\`\nSet it as TELEGRAM_SUPERGROUP_ID in conf/.env.`,
			{ parse_mode: 'Markdown' },
		)
	})

	tg.command('topics', async (ctx) => {
		const topics = db.getAllActive()
		const msg = topics.map((t) =>
			`${t.display_name} (${t.whatsapp_jid}) -> topic #${t.telegram_topic_id}`
		).join('\n')
		await ctx.reply(msg || 'No active topics yet.')
	})

	tg.command('archive', async (ctx) => {
		const topicId = (ctx.msg as any)?.message_thread_id
		if (!topicId) return
		const mapping = db.getByTopicId(topicId)
		if (mapping) {
			db.archive(mapping.whatsapp_jid)
			await ctx.reply(`Archived bridge for ${mapping.display_name} (mapping kept)`)
		}
	})

	// Alias kept for backwards compatibility.
	tg.command('close', async (ctx) => {
		const topicId = (ctx.msg as any)?.message_thread_id
		if (!topicId) return
		const mapping = db.getByTopicId(topicId)
		if (mapping) {
			db.archive(mapping.whatsapp_jid)
			await ctx.reply(`Closed bridge for ${mapping.display_name} (mapping kept)`)
		}
	})

	tg.command('reopen', async (ctx) => {
		const topicId = (ctx.msg as any)?.message_thread_id
		if (!topicId) return
		const all = db.getAll().find((t) => t.telegram_topic_id === topicId)
		if (all) {
			db.unarchive(all.whatsapp_jid)
			await ctx.reply(`Reopened bridge for ${all.display_name}`)
		}
	})

	// Telegram reaction → WhatsApp reaction. Like quotes, this resolves the
	// reacted-to Telegram message through reply_map to the WA key it mirrors.
	// Loop guard: our own WA→TG setMessageReaction echoes back as an update
	// from a bot user, which we ignore.
	tg.on('message_reaction', async (ctx) => {
		try {
			const upd: any = ctx.update.message_reaction
			if (!upd || String(upd.chat?.id) !== supergroupId) return
			if (upd.user?.is_bot) return
			if (!upd.message_id) return

			const entry = db.getReplyMap(upd.message_id)
			if (!entry) return
			const key = restoreWaKey(entry)
			if (!key) return

			const emoji = tgReactionToWaEmoji(upd.old_reaction, upd.new_reaction)
			await limiter.enqueue(async () => {
				await bot.sock.sendMessage(entry.wa_jid, { react: { text: emoji, key } })
			})
		} catch (e) {
			console.error('[BRIDGE] TG→WA reaction failed:', e)
		}
	})

	tg.on('message', async (ctx) => {
		try {
			const msg: any = ctx.msg
			// Only bridge the configured supergroup; ignore DMs/other groups.
			if (String(ctx.chat.id) !== supergroupId) return
			// Ignore the bot's own messages (loops) and non-topic (General) chatter.
			if (msg.from?.is_bot) return
			const topicId = msg.message_thread_id
			if (!topicId) return

			const mapping = db.getByTopicId(topicId)
			if (!mapping || mapping.archived) return

			const text = (msg.text || msg.caption || '').trim()
			const media = await downloadTgMedia(tg, msg)
			if (!text && !media && !msg.location && !msg.contact && !msg.poll) return

			const quoted = buildQuoted(msg, mapping.whatsapp_jid, db)
			const waContent = buildWaContent(text, media, msg)
			if (!waContent) return

			await limiter.enqueue(async () => {
				const sent = await bot.sock.sendMessage(
					mapping.whatsapp_jid,
					waContent,
					quoted ? { quoted } : undefined,
				)
				if (sent?.key?.id) {
					// Store the real key (not '{}'): buildQuoted reuses it for
					// TG→WA quotes, and getByWaMsgId needs the true stanzaId so
					// WA quotes of TG-originated messages resolve back here.
					db.saveReplyMap(
						msg.message_id,
						mapping.whatsapp_jid,
						sent.key.id,
						JSON.stringify(sent.key),
					)
				}
				db.updateLastActive(mapping.whatsapp_jid)
			})
		} catch (e) {
			console.error('[BRIDGE] TG→WA relay failed:', e)
		}
	})
}

function buildWaContent(
	text: string,
	media: { kind: string; buffer: Uint8Array; fileName?: string; mime?: string } | null,
	msg: any,
): any {
	if (msg.location) {
		const { latitude, longitude } = msg.location
		return {
			location: { degreesLatitude: latitude, degreesLongitude: longitude },
		}
	}
	if (msg.contact) {
		const c = msg.contact
		return {
			text: `Contact: ${c.first_name || ''} ${c.last_name || ''} ${c.phone_number || ''}`
				.trim(),
		}
	}
	if (msg.poll) {
		const p = msg.poll
		const opts = (p.options || []).map((o: any) => `- ${o.text}`).join('\n')
		return { text: `${text ? text + '\n' : ''}Poll: ${p.question}\n${opts}`.trim() }
	}
	if (!media) return text ? { text } : null

	// Baileys' getStream() only accepts Buffer | { stream } | { url }. A raw
	// Deno/Telegram Uint8Array falls through to `item.url.toString()` and
	// crashes with "Cannot read properties of undefined (reading 'toString')",
	// so convert every buffer to a Node Buffer first.
	const buf = Buffer.from(media.buffer)

	switch (media.kind) {
		case 'image':
			return { image: buf, caption: text || undefined }
		case 'video':
			return { video: buf, caption: text || undefined, mimetype: media.mime || 'video/mp4' }
		case 'voice':
			return { audio: buf, ptt: true, mimetype: 'audio/ogg; codecs=opus' }
		case 'audio':
			return { audio: buf, mimetype: media.mime || 'audio/mpeg' }
		case 'sticker':
			// WhatsApp stickers must be WebP. Telegram video (.webm) and
			// animated (.tgs) stickers are not — relay those as video/document
			// so they still arrive instead of failing or showing blank.
			if (media.mime === 'video/webm' || (media.fileName || '').endsWith('.webm')) {
				return { video: buf, caption: text || undefined }
			}
			if (media.mime?.includes('tgs') || (media.fileName || '').endsWith('.tgs')) {
				return {
					document: buf,
					fileName: media.fileName || 'sticker.tgs',
					mimetype: media.mime || 'application/octet-stream',
					caption: text || undefined,
				}
			}
			return { sticker: buf }
		default:
			return {
				document: buf,
				fileName: media.fileName || 'file',
				mimetype: media.mime || 'application/octet-stream',
				caption: text || undefined,
			}
	}
}

// Rebuild the Baileys key of the WA message a Telegram message mirrors.
// Current rows carry the full key JSON; legacy rows stored '{}' — those are
// always TG-originated sends (fromMe), so the key can be synthesized.
export function restoreWaKey(
	entry: { wa_jid: string; wa_msg_id: string; wa_key_json: string },
): any {
	try {
		const key = JSON.parse(entry.wa_key_json)
		if (key?.id) return key
	} catch {
		// fall through to synthesis
	}
	if (entry.wa_msg_id) {
		return { remoteJid: entry.wa_jid, id: entry.wa_msg_id, fromMe: true }
	}
	return null
}

// Pick the WhatsApp reaction text for a Telegram reaction change. Empty
// string = removal. Custom-emoji and paid reactions have no WhatsApp
// equivalent, so they fall back to ❤️ (logged by the caller path).
export function tgReactionToWaEmoji(oldList: any[], newList: any[]): string {
	const oldR = oldList || []
	const newR = newList || []
	if (newR.length === 0) return ''
	const same = (a: any, b: any) =>
		a?.type === b?.type && (a?.emoji || a?.custom_emoji_id) === (b?.emoji || b?.custom_emoji_id)
	const fresh = newR.filter((r: any) => !oldR.some((o: any) => same(o, r)))
	const pool = fresh.length > 0 ? fresh : newR
	const std = pool.find((r: any) => r?.type === 'emoji' && r?.emoji)
	if (std) return String(std.emoji)
	return '❤️'
}

// Telegram reply → WhatsApp quoted reply. The reply_map tells us which WA
// message the replied-to Telegram message mirrors. Baileys accepts a minimal
// quoted stub ({key, message}) when the full original is unavailable.
function buildQuoted(msg: any, waJid: string, db: BridgeDB): any {
	const repliedId = msg.reply_to_message?.message_id
	if (!repliedId) return null
	try {
		const entry = db.getReplyMap(repliedId)
		if (!entry) return null
		let key: any = null
		try {
			key = JSON.parse(entry.wa_key_json)
		} catch {
			key = null
		}
		if (!key?.id) {
			key = { remoteJid: waJid, id: entry.wa_msg_id, fromMe: false }
		}
		const origText = msg.reply_to_message?.text || msg.reply_to_message?.caption || ''
		return { key, message: { conversation: origText.slice(0, 500) || '...' } }
	} catch {
		return null
	}
}

interface TgMedia {
	kind: 'image' | 'video' | 'voice' | 'audio' | 'sticker' | 'document'
	buffer: Uint8Array
	fileName?: string
	mime?: string
}

async function downloadTgMedia(tg: Bot, msg: any): Promise<TgMedia | null> {
	try {
		let fileId: string | null = null
		let kind: TgMedia['kind'] = 'document'
		let fileName: string | undefined
		let mime: string | undefined

		if (msg.sticker) {
			fileId = fileIdOf(msg.sticker)
			kind = 'sticker'
			// WhatsApp only accepts WebP stickers. Flag video (.webm) and
			// animated (.tgs) ones here so buildWaContent() can relay them
			// as video/document instead.
			if (msg.sticker.is_video) {
				fileName = 'sticker.webm'
				mime = 'video/webm'
			} else if (msg.sticker.is_animated) {
				fileName = 'sticker.tgs'
				mime = 'application/x-tgs'
			} else {
				fileName = 'sticker.webp'
				mime = 'image/webp'
			}
		} else if (msg.photo?.length) {
			fileId = fileIdOf(msg.photo[msg.photo.length - 1])
			kind = 'image'
		} else if (msg.video) {
			fileId = fileIdOf(msg.video)
			kind = 'video'
			fileName = msg.video.file_name
			mime = msg.video.mime_type
		} else if (msg.video_note) {
			fileId = fileIdOf(msg.video_note)
			kind = 'video'
		} else if (msg.animation) {
			fileId = fileIdOf(msg.animation)
			kind = 'video'
			fileName = msg.animation.file_name
			mime = msg.animation.mime_type
		} else if (msg.voice) {
			fileId = fileIdOf(msg.voice)
			kind = 'voice'
		} else if (msg.audio) {
			fileId = fileIdOf(msg.audio)
			kind = 'audio'
			mime = msg.audio.mime_type
		} else if (msg.document) {
			fileId = fileIdOf(msg.document)
			kind = 'document'
			fileName = msg.document.file_name
			mime = msg.document.mime_type
		} else {
			return null
		}

		if (!fileId) return null
		const buffer = await downloadTgFile(tg, fileId)
		if (!buffer) return null
		return { kind, buffer, fileName, mime }
	} catch {
		return null
	}
}

function fileIdOf(f: any): string | null {
	if (!f) return null
	if (typeof f === 'string') return f
	if (typeof f.file_id === 'string') return f.file_id
	return null
}

async function downloadTgFile(tg: Bot, fileId: string): Promise<Uint8Array | null> {
	try {
		const token = Deno.env.get('TELEGRAM_BOT_TOKEN')!
		const file = await tg.api.getFile(fileId)
		if (!file.file_path) return null
		const res = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`)
		if (!res.ok) return null
		return new Uint8Array(await res.arrayBuffer())
	} catch {
		return null
	}
}
