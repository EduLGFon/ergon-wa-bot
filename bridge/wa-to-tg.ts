// WhatsApp → Telegram relay.
//
// IMPORTANT: this module does NOT open its own WhatsApp connection. A second
// Baileys socket sharing the same auth state fights the main bot for the
// session (stream conflict / repeated logouts). Instead we piggyback on the
// already-running bot singleton from @plugin/bot.ts.
//
// Call `attachWaRelay()` AFTER `loadEvents()` in wa.ts — loadEvents() calls
// removeAllListeners() per event, so attaching earlier would wipe our hook.
import { downloadMediaMessage, type proto } from 'baileys'
import { Bot, InputFile } from 'grammy'
import { findKey } from '@util/functions.ts'
import { logger } from '@util/proto.ts'
import bot from '@plugin/bot.ts'
import type { BridgeDB, MirrorKind } from './db.ts'
import type { RateLimiter } from './rate-limiter.ts'
import { parseVcard, type TgEntity, waMarkdownToTgEntities } from './format.ts'

let tg: Bot | null = null
let db: BridgeDB | null = null
let limiter: RateLimiter | null = null
let supergroupId: string | number = ''
const groupNameCache = new Map<string, string>()

export function attachWaRelay(tgBot: Bot, bridgeDb: BridgeDB, rateLimiter: RateLimiter): void {
	tg = tgBot
	db = bridgeDb
	limiter = rateLimiter
	supergroupId = Deno.env.get('TELEGRAM_SUPERGROUP_ID')!

	// Additional listener on the SHARED socket — the core bot handler stays untouched.
	bot.sock.ev.on('messages.upsert', async (raw: { messages: proto.IWebMessageInfo[] }) => {
		try {
			await handleWAMessages(raw.messages)
		} catch (e) {
			console.error('[BRIDGE] WA→TG handler failed:', e)
		}
	})
	// Reactions ride a separate event on the same shared socket. Attached
	// here (after loadEvents) for the same removeAllListeners reason.
	bot.sock.ev.on(
		'messages.reaction',
		async (reactions: { key: proto.IMessageKey; reaction: proto.IReaction }[]) => {
			try {
				await handleWaReactions(reactions)
			} catch (e) {
				console.error('[BRIDGE] WA→TG reaction handler failed:', e)
			}
		},
	)
	// Edits arrive as `messages.update` (protocol MESSAGE_EDIT), not upsert —
	// the bridge previously ignored them, so WA edits never reached Telegram.
	bot.sock.ev.on(
		'messages.update',
		async (updates: { key: proto.IMessageKey; update: { message?: any } }[]) => {
			try {
				await handleWaEdits(updates)
			} catch (e) {
				console.error('[BRIDGE] WA→TG edit handler failed:', e)
			}
		},
	)
	// Group membership / subject changes → service lines in the topic.
	bot.sock.ev.on('group-participants.update', async (upd: any) => {
		try {
			await handleGroupParticipants(upd)
		} catch (e) {
			console.error('[BRIDGE] WA→TG group event failed:', e)
		}
	})
	bot.sock.ev.on('groups.update', async (updates: Partial<{ id: string; subject: string }>[]) => {
		try {
			await handleGroupUpdates(updates)
		} catch (e) {
			console.error('[BRIDGE] WA→TG group update failed:', e)
		}
	})
	console.log('[BRIDGE] WA→TG relay attached to the shared WhatsApp socket')
}

async function handleWAMessages(messages: proto.IWebMessageInfo[]) {
	if (!db || !limiter || !tg) return

	for (const m of messages) {
		try {
			if (!m?.message || !m.key) continue
			// Skip protocol traffic (deletes, history sync, …)
			if (findKey(m.message, 'protocolMessage')) continue

			const jid = m.key.remoteJid
			if (!jid || jid === 'status@broadcast') continue
			// Own messages: TG→WA sends re-emit here with fromMe=true. Those
			// are already in reply_map, so skip them — but messages sent from
			// the phone/client are new (unmapped) and mirror with a `You:`
			// label. The map check doubles as redelivery dedupe.
			const echo = m.key.fromMe && !!m.key.id && !!db.getByWaMsgId(m.key.id, jid)
			if (echo) continue
			const isGroup = jid.endsWith('@g.us')
			const chatType: '1:1' | 'group' = isGroup ? 'group' : '1:1'

			const displayName = await resolveChatName(jid, m.pushName, isGroup)
			const senderName = m.key.fromMe
				? 'You'
				: (isGroup ? (m.pushName || phoneOf(m.key.participant) || 'unknown') : displayName)

			let mapping = db.getByJid(jid)
			if (!mapping || mapping.archived) {
				const topicId = await createForumTopic(displayName, isGroup)
				mapping = db.getOrCreate(jid, topicId, displayName, chatType)
				console.log(`[BRIDGE] new topic #${topicId} for ${jid} (${displayName})`)
			} else {
				if (mapping.display_name !== displayName) {
					mapping = db.getOrCreate(jid, mapping.telegram_topic_id, displayName, chatType)
				} else {
					db.updateLastActive(jid)
				}
			}
			const topicId = mapping.telegram_topic_id

			let text = getMsgText(m.message)
			const media = await downloadWaMedia(m)
			let special = getSpecialContent(m.message)
			// Content Telegram can't represent natively degrades to text
			// BEFORE entity parsing, so formatting offsets stay consistent.
			if (special?.kind === 'poll' && special.options.filter((o) => o.trim()).length < 2) {
				const opts = special.options.join('\n')
				text = `📊 ${special.question}${opts ? '\n' + opts : ''}${text ? '\n' + text : ''}`
				special = null
			}
			if (special?.kind === 'contact' && !special.phone) {
				text = `👤 ${special.name || 'Contact'}${text ? '\n' + text : ''}`
				special = null
			}

			if (!text && !media && !special) continue

			// WhatsApp quote → Telegram reply. Resolve the quoted stanzaId to
			// the Telegram message mirroring the original; when the original
			// was never bridged (history, pruned), fall back to a textual
			// quote header so context isn't silently lost.
			const quote = getQuoteInfo(m, displayName)
			let replyToTgId: number | null = null
			let quoteHeader: string | null = null
			if (quote) {
				const target = db.getByWaMsgId(quote.stanzaId, jid)
				if (target) {
					replyToTgId = target.tg_msg_id
				} else {
					quoteHeader = `↩️ ${quote.author}: ${quote.preview}`
				}
			}

			const label = m.key.fromMe ? 'You: ' : (isGroup ? `${senderName}: ` : '')
			// WhatsApp inline markers → Telegram entities. The sender label
			// (and quote header) are plain text, so entity offsets shift past
			// them. Stickers take no caption, so their fallback header still
			// travels separately via `quote.header` (sent as its own message).
			const stickerFallback = media?.kind === 'sticker' && !!quoteHeader && !replyToTgId
			const parsed = waMarkdownToTgEntities(text)
			const prefix = `${!stickerFallback && quoteHeader ? quoteHeader + '\n' : ''}${label}`
			const body = `${prefix}${parsed.text}`
			const entities = parsed.entities.map((e) => ({
				...e,
				offset: e.offset + prefix.length,
			}))
			await limiter.enqueue(() =>
				sendToTopic(topicId, body, entities, media, special, jid, m, {
					tgId: replyToTgId,
					header: stickerFallback ? quoteHeader : null,
				})
			)
		} catch (e) {
			console.error('[BRIDGE] failed to relay one WA message:', e)
		}
	}
}

async function resolveChatName(
	jid: string,
	pushName: string | undefined | null,
	isGroup: boolean,
): Promise<string> {
	if (isGroup) {
		const cached = groupNameCache.get(jid)
		if (cached) return cached
		try {
			const meta = await bot.sock.groupMetadata(jid)
			if (meta?.subject) {
				groupNameCache.set(jid, meta.subject)
				return meta.subject
			}
		} catch {
			// fall through to pushName/phone
		}
		const fallback = pushName || jid.split('@')[0]
		groupNameCache.set(jid, fallback)
		return fallback
	}
	return pushName || phoneOf(jid) || jid.split('@')[0]
}

function phoneOf(jid: string | undefined | null): string {
	if (!jid) return ''
	const user = jid.split('@')[0].split(':')[0]
	return user ? `+${user}` : ''
}

// WhatsApp reaction → Telegram reaction. Each side mirrors through a single
// bot identity (bots get one reaction per message on Telegram, one react per
// key on WhatsApp), so concurrent reactors are last-writer-wins by design.
async function handleWaReactions(
	reactions: { key: proto.IMessageKey; reaction: proto.IReaction }[],
): Promise<void> {
	if (!db || !limiter || !tg) return

	for (const { key, reaction } of reactions) {
		try {
			// Skip our own TG→WA reacts echoing back (loop guard).
			if ((reaction as any)?.key?.fromMe) continue
			const targetId = key?.id
			const jid = key?.remoteJid
			if (!targetId || !jid || jid === 'status@broadcast') continue
			const mapping = db.getByJid(jid)
			if (!mapping || mapping.archived) continue
			// Unmapped targets (pre-bridge history, pruned) can't be quoted
			// by Telegram — nothing to attach the reaction to.
			const target = db.getByWaMsgId(targetId, jid)
			if (!target) continue

			const emoji = waReactionToTgEmoji(reaction?.text)
			const payload = emoji ? [{ type: 'emoji' as const, emoji }] : []
			await limiter.enqueue(() =>
				tg!.api.setMessageReaction(supergroupId, target.tg_msg_id, payload as any)
			)
		} catch (e) {
			console.error('[BRIDGE] failed to relay one WA reaction:', e)
		}
	}
}

// Normalize a WhatsApp reaction emoji for Telegram's allowed list, which
// uses the non-VS16 form (❤, not ❤️). Returns null for removals (empty
// text) so the caller clears the reaction instead.
export function waReactionToTgEmoji(text: string | null | undefined): string | null {
	if (!text) return null
	const clean = text.replace(/\uFE0F/g, '').trim()
	return clean || null
}

async function createForumTopic(displayName: string, _isGroup: boolean): Promise<number> {
	if (!tg) throw new Error('Telegram bot not initialized')
	const name = (displayName || 'Unknown').slice(0, 128) || 'Unknown'
	const topic = await tg.api.createForumTopic(supergroupId, name)
	return topic.message_thread_id
}

async function sendToTopic(
	topicId: number,
	body: string,
	entities: TgEntity[],
	media:
		| { kind: string; buffer: Uint8Array; mime?: string; fileName?: string; ptt?: boolean }
		| null,
	special: WaSpecial | null,
	waJid: string,
	waMsg: proto.IWebMessageInfo,
	quote: { tgId: number | null; header: string | null },
): Promise<void> {
	if (!tg || !db) return
	// Native Telegram quote when the original was bridged. allow_sending_
	// without_reply keeps the send alive if that message was deleted since.
	const reply = quote.tgId
		? { reply_parameters: { message_id: quote.tgId, allow_sending_without_reply: true } }
		: undefined
	const rich = entities.length > 0 ? { entities } : undefined
	const thread = { message_thread_id: topicId } as const
	const save = (tgId: number, kind: MirrorKind): void => {
		db!.saveReplyMap(tgId, waJid, waMsg.key?.id || '', JSON.stringify(waMsg.key || {}), kind)
	}

	// Location / contact / poll have no caption concept: the content goes
	// first (carrying the native reply), then any text as a follow-up.
	if (special) {
		const sentId = await sendSpecial(topicId, special, reply)
		if (sentId) save(sentId, 'special')
		if (body) {
			const sent = await tg.api.sendMessage(supergroupId, body, {
				...thread,
				...rich,
			})
			save(sent.message_id, 'text')
		}
		return
	}

	if (!media) {
		const sent = await tg.api.sendMessage(supergroupId, body, {
			message_thread_id: topicId,
			...rich,
			...reply,
		})
		save(sent.message_id, 'text')
		return
	}

	// Stickers take no caption: deliver an unmapped quote header as its own
	// message so the context still lands in the topic.
	if (media.kind === 'sticker' && quote.header && !quote.tgId) {
		await tg.api.sendMessage(supergroupId, quote.header, { message_thread_id: topicId })
	}

	const caption = body.length > 1024 ? undefined : (body || undefined)
	const captionEntities = caption && entities.length > 0
		? { caption_entities: entities }
		: undefined
	const file = new InputFile(media.buffer, media.fileName || `file.${extOf(media)}`)
	let sent: { message_id: number }

	switch (media.kind) {
		case 'image':
			sent = await tg.api.sendPhoto(supergroupId, file, {
				...thread,
				caption,
				...captionEntities,
				...reply,
			})
			break
		case 'video':
			sent = await tg.api.sendVideo(supergroupId, file, {
				...thread,
				caption,
				...captionEntities,
				...reply,
			})
			break
		case 'voice':
			sent = await tg.api.sendVoice(supergroupId, file, {
				...thread,
				caption,
				...captionEntities,
				...reply,
			})
			break
		case 'audio':
			sent = await tg.api.sendAudio(supergroupId, file, {
				...thread,
				caption,
				...captionEntities,
				...reply,
			})
			break
		case 'sticker':
			sent = await tg.api.sendSticker(supergroupId, file, {
				message_thread_id: topicId,
				...reply,
			})
			break
		default:
			sent = await tg.api.sendDocument(supergroupId, file, {
				...thread,
				caption,
				...captionEntities,
				...reply,
			})
			break
	}
	save(sent.message_id, media.kind === 'sticker' ? 'sticker' : 'media')

	// Captions are capped at 1024 chars — send the overflow as a follow-up.
	if (caption === undefined && body) {
		await tg.api.sendMessage(supergroupId, body, { message_thread_id: topicId, ...rich })
	}
}

// Sends a location/contact/poll content message. Returns the sent Telegram
// message id (null when the content degrades to a text fallback instead).
async function sendSpecial(
	topicId: number,
	special: WaSpecial,
	reply:
		| { reply_parameters: { message_id: number; allow_sending_without_reply: boolean } }
		| undefined,
): Promise<number | null> {
	if (!tg) return null
	const thread = { message_thread_id: topicId } as const
	switch (special.kind) {
		case 'location': {
			const sent = await tg.api.sendLocation(
				supergroupId,
				special.latitude,
				special.longitude,
				{ ...thread, ...reply },
			)
			return sent.message_id
		}
		case 'contact': {
			const sent = await tg.api.sendContact(supergroupId, special.phone, special.name, {
				...thread,
				...reply,
			})
			return sent.message_id
		}
		case 'poll': {
			const question = special.question.slice(0, 300) || 'Poll'
			const options = special.options
				.map((o) => o.slice(0, 100))
				.filter((o) => o.length > 0)
				.slice(0, 10)
			// Telegram needs 2–10 options; shorter lists were already
			// degraded to text by the caller, so this is just a guard.
			if (options.length < 2) return null
			const sent = await tg.api.sendPoll(
				supergroupId,
				question,
				options.map((text) => ({ text })),
				{
					...thread,
					is_anonymous: false,
					...reply,
				},
			)
			return sent.message_id
		}
	}
}

// Location / contact / poll extraction (WhatsApp → Telegram).
export interface WaSpecialLocation {
	kind: 'location'
	latitude: number
	longitude: number
}
export interface WaSpecialContact {
	kind: 'contact'
	name: string
	phone: string
}
export interface WaSpecialPoll {
	kind: 'poll'
	question: string
	options: string[]
}
export type WaSpecial = WaSpecialLocation | WaSpecialContact | WaSpecialPoll

export function getSpecialContent(message: proto.IMessage | undefined | null): WaSpecial | null {
	try {
		const raw = unwrap(message)
		if (!raw || typeof raw !== 'object') return null
		if (raw.locationMessage) {
			const { degreesLatitude, degreesLongitude } = raw.locationMessage
			if (typeof degreesLatitude === 'number' && typeof degreesLongitude === 'number') {
				return { kind: 'location', latitude: degreesLatitude, longitude: degreesLongitude }
			}
		}
		if (raw.liveLocationMessage) {
			const { latitude, longitude } = raw.liveLocationMessage
			if (typeof latitude === 'number' && typeof longitude === 'number') {
				return { kind: 'location', latitude, longitude }
			}
		}
		if (raw.contactMessage) {
			const { name, phone } = parseVcard(raw.contactMessage.vcard)
			return {
				kind: 'contact',
				name: raw.contactMessage.displayName || name || phone || 'Contact',
				phone,
			}
		}
		if (raw.pollCreationMessage) {
			const options = (raw.pollCreationMessage.options || [])
				.map((o: any) => String(o?.optionName || '').trim())
				.filter((o: string) => o.length > 0)
			return {
				kind: 'poll',
				question: String(raw.pollCreationMessage.name || 'Poll'),
				options,
			}
		}
		return null
	} catch {
		return null
	}
}

// WhatsApp message edit → Telegram edit. Edits arrive as `messages.update`
// with `update.message.editedMessage.message` (never as upsert). The mirror
// message is always bot-owned, so Telegram's 48h edit window is the only
// platform limit — but mirrors of stickers/polls/venues/contacts can't be
// edited at all, and rows predating tg_kind fall back to try-both.
async function handleWaEdits(
	updates: { key: proto.IMessageKey; update: { message?: any } }[],
): Promise<void> {
	if (!db || !limiter || !tg) return

	for (const { key, update } of updates) {
		try {
			const edited = update?.message?.editedMessage?.message
			if (!edited || typeof edited !== 'object') continue
			const jid = key?.remoteJid
			const id = key?.id
			if (!jid || !id || jid === 'status@broadcast') continue
			// Echo of our own TG→WA edit (marked before the WA send) — the
			// TG message already shows this text; editing would 400.
			if (db.takeTgEdit(jid, id)) {
				console.debug(`[BRIDGE] skipping echo of TG-initiated edit ${id}`)
				continue
			}
			const mapping = db.getByJid(jid)
			if (!mapping || mapping.archived) continue
			const target = db.getByWaMsgId(id, jid)
			if (!target) continue

			const route = routeEdit((target as { tg_kind?: string }).tg_kind)
			if (route === 'skip') {
				console.debug(
					`[BRIDGE] skipping edit of non-editable TG mirror (kind=${target.tg_kind})`,
				)
				continue
			}

			const isGroup = jid.endsWith('@g.us')
			const label = key.fromMe
				? 'You: '
				: (isGroup ? `${phoneOf(key.participant) || 'unknown'}: ` : '')
			const parsed = waMarkdownToTgEntities(getMsgText(edited as proto.IMessage))
			const body = `${label}${parsed.text}`
			const entities = parsed.entities.map((e) => ({ ...e, offset: e.offset + label.length }))
			const rich = entities.length > 0 ? { entities } : undefined

			await limiter.enqueue(async () => {
				try {
					if (route === 'text' || route === 'both') {
						await tg!.api.editMessageText(supergroupId, target.tg_msg_id, body, rich)
						return
					}
					await tg!.api.editMessageCaption(supergroupId, target.tg_msg_id, {
						caption: body.slice(0, 1024) || undefined,
					})
				} catch (first) {
					// Legacy 'unknown' rows: the mirror type is a guess, so a
					// failed text edit retries as caption before giving up.
					if (route === 'both') {
						try {
							await tg!.api.editMessageCaption(supergroupId, target.tg_msg_id, {
								caption: body.slice(0, 1024) || undefined,
							})
							return
						} catch (second) {
							logEditFailure(target.tg_msg_id, second, String(describeErr(first)))
							return
						}
					}
					logEditFailure(target.tg_msg_id, first)
				}
			})
		} catch (e) {
			console.error('[BRIDGE] failed to relay one WA edit:', e)
		}
	}
}

// Which Telegram edit endpoint a mirror kind needs. Stickers, polls,
// venues, contacts and locations have no bot-editable representation —
// attempting them only produces 400s, so they are skipped up front.
export function routeEdit(tgKind: string | undefined): 'text' | 'caption' | 'both' | 'skip' {
	switch (tgKind) {
		case 'text':
			return 'text'
		case 'media':
			return 'caption'
		case 'sticker':
		case 'special':
			return 'skip'
		default:
			return 'both'
	}
}

// Log an edit failure at the right level instead of always erroring:
// 'not modified' is a harmless duplicate, "can't be edited"/"not found" is
// an expired window, deleted message or wrong type — only the rest is a bug.
export function classifyEditError(err: unknown): 'debug' | 'warn' | 'error' {
	const desc = describeErr(err).toLowerCase()
	if (desc.includes('not modified')) return 'debug'
	if (desc.includes("can't be edited") || desc.includes('not found')) return 'warn'
	return 'error'
}

function describeErr(err: unknown): string {
	if (typeof err === 'string') return err
	const anyErr = err as { description?: unknown; message?: unknown }
	if (typeof anyErr?.description === 'string') return anyErr.description
	if (typeof anyErr?.message === 'string') return anyErr.message
	try {
		return JSON.stringify(err)
	} catch {
		return String(err)
	}
}

function logEditFailure(tgMsgId: number, err: unknown, firstErr?: string): void {
	const level = classifyEditError(err)
	const detail = `${describeErr(err)}${firstErr ? ` (first attempt: ${firstErr})` : ''}`
	const line = `[BRIDGE] edit of TG message ${tgMsgId} failed (${level}): ${detail}`
	if (level === 'debug') console.debug(line)
	else if (level === 'warn') console.warn(line)
	else console.error(line)
}

// Group membership changes → service lines in the topic.
async function handleGroupParticipants(upd: {
	id: string
	participants: (string | { id?: string })[]
	action: string
}): Promise<void> {
	if (!db || !limiter || !tg) return
	try {
		const mapping = db?.getByJid(upd.id)
		if (!mapping || mapping.archived) return
		const names = (upd.participants || [])
			.map((p) => phoneOf(typeof p === 'string' ? p : p?.id) || 'someone')
			.join(', ')
		let line: string | null = null
		switch (upd.action) {
			case 'add':
				line = `👋 ${names} joined the group`
				break
			case 'remove':
				line = `🚪 ${names} left the group`
				break
			case 'promote':
				line = `⭐ ${names} is now an admin`
				break
			case 'demote':
				line = `◽ ${names} is no longer an admin`
				break
			default:
				return
		}
		await limiter.enqueue(() =>
			tg!.api.sendMessage(supergroupId, line!, {
				message_thread_id: mapping.telegram_topic_id,
			})
		)
	} catch (e) {
		console.error('[BRIDGE] failed to relay group participants:', e)
	}
}

// Group subject changes → rename mapping + topic (best effort).
async function handleGroupUpdates(
	updates: Partial<{ id: string; subject: string }>[],
): Promise<void> {
	if (!db || !limiter || !tg) return
	for (const u of updates || []) {
		try {
			if (!u?.id || !u.subject) continue
			const mapping = db.getByJid(u.id)
			if (!mapping || mapping.archived) continue
			if (mapping.display_name === u.subject) continue
			groupNameCache.set(u.id, u.subject)
			db.getOrCreate(u.id, mapping.telegram_topic_id, u.subject, mapping.chat_type)
			await limiter.enqueue(() =>
				tg!.api.editForumTopic(supergroupId, mapping.telegram_topic_id, {
					name: u.subject!.slice(0, 128),
				}).catch(() => false)
			)
			console.log(`[BRIDGE] renamed topic #${mapping.telegram_topic_id} to ${u.subject}`)
		} catch (e) {
			console.error('[BRIDGE] failed to relay group update:', e)
		}
	}
}

function extOf(media: { kind: string; mime?: string }): string {
	if (media.mime?.includes('/')) {
		const ext = media.mime.split('/')[1].split(';')[0].split('+')[0]
		if (ext && ext.length <= 5) return ext
	}
	switch (media.kind) {
		case 'image':
			return 'jpg'
		case 'video':
			return 'mp4'
		case 'voice':
		case 'audio':
			return 'ogg'
		case 'sticker':
			return 'webp'
		default:
			return 'bin'
	}
}

function getMsgText(message: proto.IMessage): string {
	for (const key of ['conversation', 'text', 'caption']) {
		const res = findKey(message, key)
		if (res) return String(res).trim()
	}
	return ''
}

interface WaQuote {
	stanzaId: string
	preview: string
	author: string
}

export type { WaQuote }

// Extract the WhatsApp quote (contextInfo) from an incoming message, if any.
// Reads contextInfo off the unwrapped top-level content node directly —
// never a deep search — so a nested quote-inside-a-quote can't be mistaken
// for the outer one. (findKey also skips quotedMessage subtrees, which is
// why getMsgText above returns the reply's own text, not the quoted text.)
export function getQuoteInfo(m: proto.IWebMessageInfo, fallbackAuthor: string): WaQuote | null {
	try {
		const raw = unwrap(m.message)
		if (!raw || typeof raw !== 'object') return null
		let ctx: any = null
		for (const value of Object.values(raw)) {
			if (value && typeof value === 'object' && (value as any).contextInfo?.stanzaId) {
				ctx = (value as any).contextInfo
				break
			}
		}
		if (!ctx) return null
		return {
			stanzaId: String(ctx.stanzaId),
			preview: describeQuoted(ctx.quotedMessage),
			author: ctx.participant ? phoneOf(ctx.participant) : fallbackAuthor,
		}
	} catch {
		return null
	}
}

// Short human-readable summary of the quoted original for the fallback
// header (used only when the original was never bridged to Telegram).
function describeQuoted(quotedMessage: any): string {
	if (quotedMessage && typeof quotedMessage === 'object') {
		const text = getMsgText(quotedMessage as proto.IMessage)
		if (text) return text.length > 200 ? text.slice(0, 200) + '…' : text
		const key = Object.keys(quotedMessage)[0] || ''
		if (key.includes('image')) return '📷 a photo'
		if (key.includes('video')) return '🎥 a video'
		if (key.includes('audio')) return '🎵 an audio message'
		if (key.includes('sticker')) return 'a sticker'
		if (key.includes('document')) return '📄 a document'
		if (key.includes('location')) return '📍 a location'
		if (key.includes('contact')) return '👤 a contact'
		if (key.includes('poll')) return '📊 a poll'
	}
	return 'a message'
}

interface WaMedia {
	kind: 'image' | 'video' | 'voice' | 'audio' | 'sticker' | 'document'
	buffer: Uint8Array
	mime?: string
	fileName?: string
	ptt?: boolean
}

async function downloadWaMedia(m: proto.IWebMessageInfo): Promise<WaMedia | null> {
	try {
		const raw = unwrap(m.message)
		if (!raw) return null

		let kind: WaMedia['kind'] | null = null
		let node: any = null
		if (raw.imageMessage) {
			kind = 'image'
			node = raw.imageMessage
		} else if (raw.videoMessage) {
			kind = 'video'
			node = raw.videoMessage
		} else if (raw.audioMessage) {
			kind = raw.audioMessage.ptt ? 'voice' : 'audio'
			node = raw.audioMessage
		} else if (raw.stickerMessage) {
			kind = 'sticker'
			node = raw.stickerMessage
		} else if (raw.documentMessage) {
			kind = 'document'
			node = raw.documentMessage
		} else {
			return null
		}
		if (!node?.url && !node?.directPath) return null

		const buffer = await downloadMediaMessage(
			m as any,
			'buffer',
			{},
			{ reuploadRequest: bot.sock.updateMediaMessage, logger },
		).catch(() => null) as Buffer | Uint8Array | null
		if (!buffer) return null

		return {
			kind,
			buffer: new Uint8Array(buffer),
			mime: node.mimetype,
			fileName: node.fileName,
			ptt: node.ptt,
		}
	} catch {
		return null
	}
}

// Peel view-once / ephemeral wrappers so media underneath is reachable.
function unwrap(message: proto.IMessage | undefined | null): any {
	let node: any = message
	for (let i = 0; i < 4 && node; i++) {
		if (node.viewOnceMessageV2) node = node.viewOnceMessageV2.message
		else if (node.viewOnceMessage) node = node.viewOnceMessage.message
		else if (node.ephemeralMessage) node = node.ephemeralMessage.message
		else if (node.documentWithCaptionMessage) node = node.documentWithCaptionMessage.message
		else break
	}
	return node
}
