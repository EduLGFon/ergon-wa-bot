// Group settings menu - members browser plus topic toggles in one place.
//
// `/group` inside a group topic opens a single menu message that is edited in
// place through menu, member list, search results and member card states, so
// even a 1000+ roster costs one message: the roster loads once from WA
// `groupMetadata` (cached 60s), pages of 8 turn via tiny callback payloads
// (`gm:<tok>:<op>:<arg>`, server-side sessions, never JIDs on the wire), and
// search filters in memory. Typing a query arms an intercept: the next typed
// (non-command) message from that user in the topic is consumed and deleted
// instead of relaying to WhatsApp. Starting a chat mirrors `/new` (verify,
// topic, mapping, profile card) into the menu's own group.
import { moveTopic } from '../wa-to-tg/move.ts'
import { syncProfileCard } from '../wa-to-tg/profile.ts'
import { bucketOfChat, chatOfBucket, type GroupIds, isDual } from '../wa-to-tg/routing.ts'
import { filterMembers, loadGroupMembers, type MemberItem } from './group-members.ts'
import type { TgCall } from './commands.ts'
import type { BridgeDB } from '../db.ts'
import type { Bot } from 'grammy'
import bot from '@plugin/bot.ts'

const PAGE_SIZE = 8
const SEARCH_TTL_MS = 60_000
const SESSION_TTL_MS = 15 * 60_000
const MAX_SESSIONS = 50
const MAX_ARMS = 200

interface MenuSession {
	tok: string
	chatId: string
	topicId: number
	groupJid: string
	msgId: number
	mode: 'menu' | 'list' | 'results' | 'card'
	all: MemberItem[]
	items: MemberItem[]
	subject: string
	page: number
	sel: number
	query: string
	dual: boolean
	at: number
}

const sessions = new Map<string, MenuSession>()
// Armed search queries by chat:topic:user - one typed message is eaten next.
const searchArms = new Map<string, { tok: string; exp: number }>()

function dropSession(tok: string): void {
	sessions.delete(tok)
}

function rememberSession(s: MenuSession): void {
	s.at = Date.now()
	sessions.set(s.tok, s)
	if (sessions.size <= MAX_SESSIONS) return
	let oldest: string | null = null
	let oldestAt = Infinity
	for (const [k, v] of sessions) {
		if (v.at < oldestAt) {
			oldestAt = v.at
			oldest = k
		}
	}
	if (oldest) sessions.delete(oldest)
}

function takeSession(tok: string): MenuSession | null {
	const s = sessions.get(tok)
	if (!s || Date.now() - s.at > SESSION_TTL_MS) {
		if (s) sessions.delete(tok)
		return null
	}
	return s
}

function freshTok(): string {
	let tok = ''
	do {
		tok = Math.random().toString(36).slice(2, 8)
	} while (sessions.has(tok))
	return tok
}

function memberLine(m: MemberItem, i: number): string {
	const star = m.admin ? '⭐ ' : ''
	const phone = m.phone && m.phone !== m.label ? ` (${m.phone})` : ''
	return `${i + 1}. ${star}${m.label}${phone}`
}

function btn(label: string, data: string): { text: string; callback_data: string } {
	return { text: label, callback_data: data }
}

function kb(rows: { text: string; callback_data: string }[][]): {
	reply_markup: { inline_keyboard: { text: string; callback_data: string }[][] }
} {
	return { reply_markup: { inline_keyboard: rows } }
}

function menuView(s: MenuSession, db: BridgeDB): { text: string; extra: unknown } {
	const mapping = db.getByJidOrAlias(s.groupJid)
	const bucket = mapping?.bucket ?? 'undecided'
	const muted = mapping?.muted ?? false
	const text = `${s.subject}\n${s.all.length} members · ${bucket}${muted ? ' · muted' : ''}`
	const rows = [
		[btn(`👥 Members (${s.all.length})`, `gm:${s.tok}:list:0`)],
		[btn(muted ? '🔕 Unmute' : '🔔 Mute', `gm:${s.tok}:mute`)],
	]
	if (s.dual) {
		rows.push([
			btn(bucket === 'personal' ? '✓ Personal' : 'Personal', `gm:${s.tok}:bkt:personal`),
			btn(bucket === 'business' ? '✓ Business' : 'Business', `gm:${s.tok}:bkt:business`),
		])
	}
	rows.push([btn('❌ Close', `gm:${s.tok}:close`)])
	return { text, extra: kb(rows) }
}

function listView(s: MenuSession, title: string): { text: string; extra: unknown } {
	const pages = Math.max(1, Math.ceil(s.items.length / PAGE_SIZE))
	s.page = Math.min(Math.max(0, s.page), pages - 1)
	const start = s.page * PAGE_SIZE
	const slice = s.items.slice(start, start + PAGE_SIZE)
	const lines = slice.map((m, k) => memberLine(m, start + k))
	const text = `${title} (${s.items.length}) - page ${s.page + 1}/${pages}\n${
		lines.join('\n') || 'No matches.'
	}`
	const rows = slice.map((m, k) => [btn(m.label.slice(0, 28), `gm:${s.tok}:view:${start + k}`)])
	rows.push([
		btn('◀', `gm:${s.tok}:list:${s.page - 1}`),
		btn('🔍', `gm:${s.tok}:search`),
		btn('🔙', `gm:${s.tok}:back`),
		btn('▶', `gm:${s.tok}:list:${s.page + 1}`),
	])
	return { text, extra: kb(rows) }
}

function cardView(s: MenuSession): { text: string; extra: unknown } {
	const m = s.items[s.sel]
	if (!m) return listView(s, s.mode === 'results' ? `Results for "${s.query}"` : 'Members')
	const text = `${m.admin ? '⭐ ' : ''}${m.label}\n${m.phone || ''}${m.admin ? '\nAdmin' : ''}`
	const rows = [
		[btn('💬 Start chat', `gm:${s.tok}:chat`)],
		[btn('🔙 Back', `gm:${s.tok}:back`)],
	]
	return { text, extra: kb(rows) }
}

async function renderSession(tg: Bot, db: BridgeDB, s: MenuSession): Promise<boolean> {
	s.at = Date.now()
	const v = s.mode === 'menu'
		? menuView(s, db)
		: s.mode === 'card'
		? cardView(s)
		: listView(s, s.mode === 'results' ? `Results for "${s.query}"` : 'Members')
	try {
		await tg.api.editMessageText(s.chatId, s.msgId, v.text, v.extra as object)
		return true
	} catch {
		return false
	}
}

// Armed search eats one typed message: deleted after reading so it never
// reaches WhatsApp. Commands (starting with /) always pass through.
export async function consumeMemberSearch(
	tg: Bot,
	db: BridgeDB,
	chatId: string,
	topicId: number,
	msg: { from?: { id?: number }; text?: string; message_id?: number },
): Promise<boolean> {
	const uid = msg.from?.id
	const text = typeof msg.text === 'string' ? msg.text.trim() : ''
	if (!uid || !text || text.startsWith('/')) return false
	const arm = searchArms.get(`${chatId}:${topicId}:${uid}`)
	if (!arm) return false
	searchArms.delete(`${chatId}:${topicId}:${uid}`)
	if (Date.now() > arm.exp) return false
	const s = takeSession(arm.tok)
	if (!s) return false
	try {
		if (msg.message_id) await tg.api.deleteMessage(chatId, msg.message_id).catch(() => null)
	} catch {
		// The query stays visible - search still runs below.
	}
	s.items = filterMembers(s.all, text.slice(0, 100))
	s.query = text.slice(0, 100)
	s.page = 0
	s.mode = 'results'
	rememberSession(s)
	await renderSession(tg, db, s)
	return true
}

// Open a 1:1 bridged chat with a roster member - same shape as `/new`
// (verify, topic in this group, mapping, profile card), no duplicates.
async function startMemberChat(
	tg: Bot,
	db: BridgeDB,
	groups: GroupIds,
	tgCall: TgCall,
	s: MenuSession,
	answer: (text: string) => Promise<unknown>,
): Promise<void> {
	const m = s.items[s.sel]
	if (!m) {
		await answer('Member not found.')
		return
	}
	let digits = ''
	if (m.jid.endsWith('@s.whatsapp.net') || m.jid.endsWith('@c.us')) {
		digits = m.jid.split('@')[0].split(':')[0].replace(/\D/g, '')
	} else if (m.jid.endsWith('@lid')) {
		try {
			const pn = await (bot.sock as any)?.signalRepository?.lidMapping?.getPNForLID?.(m.jid)
			if (typeof pn === 'string') {
				digits = pn.split('@')[0].split(':')[0].replace(/\D/g, '')
			}
		} catch {
			digits = ''
		}
	}
	if (!digits || digits.length < 7) {
		await answer('No phone for this member - cannot open a chat.')
		return
	}
	const jid = `${digits}@s.whatsapp.net`
	const existing = db.getByJidOrAlias(jid)
	if (existing && !existing.archived) {
		await answer(`Already bridged in topic #${existing.telegram_topic_id}.`)
		return
	}
	const lookup = await bot.sock.onWhatsApp(jid).catch(() => [])
	if (!lookup?.[0]?.exists) {
		await answer('Not on WhatsApp.')
		return
	}
	const topic = await tgCall(
		() => tg.api.createForumTopic(s.chatId, m.label.slice(0, 128)),
		'new-topic',
		s.chatId,
	) as { message_thread_id: number }
	db.getOrCreate(jid, topic.message_thread_id, m.label, '1:1', s.chatId)
	const bucket = bucketOfChat(s.chatId, groups)
	if (bucket) db.setBucket(jid, bucket)
	await syncProfileCard({
		jid,
		displayName: m.label,
		chatType: '1:1',
		isGroup: false,
		topicId: topic.message_thread_id,
		chatId: s.chatId,
	}, { force: true }).catch((e) => console.error('[BRIDGE] member chat card failed:', e))
	dropSession(s.tok)
	try {
		await tg.api.editMessageText(
			s.chatId,
			s.msgId,
			`✅ Chat opened with ${m.label} (topic #${topic.message_thread_id}).`,
		)
	} catch {
		// Menu already gone - the new topic is the confirmation.
	}
	await answer('Chat opened.')
}

export function registerGroupMenuHandlers(
	tg: Bot,
	db: BridgeDB,
	groups: GroupIds,
	tgCall: TgCall,
	inSupergroup: (ctx: { chat?: { id?: string | number } }) => boolean,
): void {
	tg.command('group', async (ctx) => {
		try {
			if (!inSupergroup(ctx)) return
			const chatId = String(ctx.chat.id)
			const topicId = (ctx.msg as any)?.message_thread_id
			if (!topicId) return
			const mapping = db.getByTopic(chatId, topicId)
			if (!mapping) {
				await ctx.reply('No bridged chat in this topic.')
				return
			}
			if (mapping.chat_type !== 'group') {
				await ctx.reply('Run /group inside a group topic.')
				return
			}
			const loaded = await loadGroupMembers(mapping.whatsapp_jid)
			if (!loaded) {
				await ctx.reply('Could not load group members - try again.')
				return
			}
			const s: MenuSession = {
				tok: freshTok(),
				chatId,
				topicId,
				groupJid: mapping.whatsapp_jid,
				msgId: 0,
				mode: 'menu',
				all: loaded.items,
				items: loaded.items,
				subject: loaded.subject,
				page: 0,
				sel: 0,
				query: '',
				dual: isDual(groups),
				at: Date.now(),
			}
			const v = menuView(s, db)
			const sent = await ctx.reply(v.text, {
				message_thread_id: topicId,
				...(v.extra as object),
			})
			s.msgId = (sent as { message_id?: number })?.message_id ?? 0
			if (!s.msgId) return
			rememberSession(s)
		} catch (e) {
			console.error('[BRIDGE] /group failed:', e)
		}
	})

	tg.callbackQuery(/^gm:/, async (ctx) => {
		try {
			const chatId = String(ctx.chat?.id ?? '')
			const parts = String((ctx.callbackQuery as { data?: string })?.data || '').split(':')
			const sess = takeSession(parts[1] || '')
			if (!sess || sess.chatId !== chatId) {
				await ctx.answerCallbackQuery({ text: 'Menu expired - run /group again.' })
					.catch(() => null)
				return
			}
			const s = sess
			const op = parts[2] || ''
			const arg = parts.slice(3).join(':')
			const answer = (text: string): Promise<unknown> =>
				ctx.answerCallbackQuery({ text }).catch(() => null)
			const redraw = async (): Promise<void> => {
				rememberSession(s)
				const ok = await renderSession(tg, db, s)
				if (!ok) {
					dropSession(s.tok)
					await answer('Menu gone - run /group again.')
				}
			}
			if (op === 'close') {
				dropSession(s.tok)
				await tg.api.deleteMessage(s.chatId, s.msgId).catch(() => null)
				await ctx.answerCallbackQuery().catch(() => null)
				return
			}
			if (op === 'list') {
				s.mode = 'list'
				s.items = s.all
				s.page = Number(arg) || 0
				await redraw()
				await ctx.answerCallbackQuery().catch(() => null)
				return
			}
			if (op === 'view') {
				const idx = Number(arg)
				if (!Number.isFinite(idx) || !s.items[idx]) {
					await answer('Member not found.')
					return
				}
				s.mode = 'card'
				s.sel = idx
				await redraw()
				await ctx.answerCallbackQuery().catch(() => null)
				return
			}
			if (op === 'back') {
				s.mode = s.query ? 'results' : (s.items === s.all ? 'menu' : 'list')
				if (s.mode === 'menu') {
					s.items = s.all
					s.query = ''
				}
				await redraw()
				await ctx.answerCallbackQuery().catch(() => null)
				return
			}
			if (op === 'search') {
				const key = `${s.chatId}:${s.topicId}:${ctx.from?.id ?? 0}`
				if (searchArms.size >= MAX_ARMS) {
					const oldest = searchArms.keys().next().value
					if (oldest !== undefined) searchArms.delete(oldest)
				}
				searchArms.set(key, { tok: s.tok, exp: Date.now() + SEARCH_TTL_MS })
				await answer('Send a name or number (60s) - it will be deleted after reading.')
				return
			}
			if (op === 'chat') {
				await ctx.answerCallbackQuery({ text: 'Opening chat…' }).catch(() => null)
				await startMemberChat(tg, db, groups, tgCall, s, answer).catch(async (e) => {
					console.error('[BRIDGE] member chat failed:', e)
					await answer('Could not open the chat.')
				})
				return
			}
			if (op === 'mute') {
				const mapping = db.getByJidOrAlias(s.groupJid)
				if (!mapping) {
					await answer('Chat not found.')
					return
				}
				db.setMuted(s.groupJid, !mapping.muted)
				await redraw()
				await answer(mapping.muted ? 'Unmuted.' : 'Muted.')
				return
			}
			if (op === 'bkt') {
				const bucket = arg === 'business' ? 'business' : 'personal'
				const mapping = db.getByJidOrAlias(s.groupJid)
				if (!mapping) {
					await answer('Chat not found.')
					return
				}
				if (mapping.bucket === bucket) {
					await answer(`Already in ${bucket === 'business' ? 'Business' : 'Personal'}.`)
					return
				}
				if (!chatOfBucket(bucket, groups)) {
					await answer('Group is not configured.')
					return
				}
				await ctx.answerCallbackQuery({ text: 'Moving…' }).catch(() => null)
				void moveTopic(s.groupJid, bucket).then(async (res) => {
					try {
						if (!res?.moved) {
							rememberSession(s)
							await renderSession(tg, db, s)
							return
						}
						// Business wipes the old topic (menu included) - nothing
						// to update. Personal leaves a pointer topic behind.
						try {
							await tg.api.editMessageText(
								s.chatId,
								s.msgId,
								`Moved to Personal - continue in the new topic.`,
							)
						} catch {
							// Menu already gone - nothing left to say.
						}
						dropSession(s.tok)
					} catch (e) {
						console.error('[BRIDGE] menu move failed:', e)
					}
				}).catch((e) => console.error('[BRIDGE] menu move failed:', e))
				return
			}
			await ctx.answerCallbackQuery().catch(() => null)
		} catch (e) {
			console.error('[BRIDGE] group menu button failed:', e)
		}
	})
}
