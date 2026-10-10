// WhatsApp reaction tracker - merged counts inside the mirror plus a viewer.
//
// Telegram bots get one native reaction per message and reject many WA
// emojis, so the old last-writer-wins mirror showed a single mapped emoji.
// This tracks every reactor by author from the upsert carriers (the
// messages.reaction event carries no author), persists the roster on the
// reply_map row (7-day prune, no new retention), and renders a compact
// footer into the mirror itself (`heart 2  thumbsup 1`, original WA emojis,
// nothing mapped away) with a stateless `rx:<id>` button that reveals who
// reacted on each emoji. Editable mirrors (text, media captions) are edited
// in place; stickers, polls and other non-editable mirrors keep a compact
// reply line instead. The popular emoji is still set natively best-effort.
// See DECISIONS.md#D09.
import { applyTgReaction, waReactionToTgEmoji } from './reactions.ts'
import { notifyTopic, relayCtx, shortErr, tgCall } from './state.ts'
import { candidatesOf, normalizeJid, selfJid, stripDevice } from './jid.ts'
import { aesDecryptGCM, hmacSign, proto } from 'baileys'
import bot from '@plugin/bot.ts'
import { storedText } from './media-utils.ts'
import { bucketOfChat, chatForReply, type GroupIds } from './routing.ts'
import { phoneOf } from './text.ts'
import { routeEdit } from './errors.ts'
import type { ReplyMapRow } from '../db.ts'
import type { Bot } from 'grammy'

interface ReactionVoter {
	n: string
	e: string
	t: number
}

export interface ReactionState {
	v: Record<string, ReactionVoter>
	s: number | null
}

// Bounds so one viral message cannot grow the row without limit.
const MAX_VOTERS = 100
const MAX_EMOJIS = 20
const MAX_NAMES = 10
const ALERT_CHARS = 180
const INLINE_BASE_MAX = 900

// Original WA emoji, VS16 and skin tones stripped so variants group
// together. Never mapped - unsupported emojis stay visible in the footer.
export function cleanReactionEmoji(text: string | null | undefined): string {
	if (!text) return ''
	const clean = text.replace(/\uFE0F/g, '').replace(/[\u{1F3FB}-\u{1F3FF}]/gu, '').trim()
	return clean.slice(0, 16)
}

export function parseState(raw: string | null | undefined): ReactionState {
	const out: ReactionState = { v: {}, s: null }
	if (!raw) return out
	try {
		const data = JSON.parse(raw) as Partial<ReactionState>
		if (data && typeof data.v === 'object' && data.v !== null) {
			for (const [k, rec] of Object.entries(data.v)) {
				const r = rec as Partial<ReactionVoter>
				if (typeof r.n === 'string' && typeof r.e === 'string') {
					out.v[k] = { n: r.n.slice(0, 64), e: r.e.slice(0, 16), t: Number(r.t) || 0 }
				}
			}
		}
		if (typeof data.s === 'number' && data.s > 0) out.s = data.s
	} catch {
		// Start fresh - the next reaction rebuilds.
	}
	return out
}

interface EmojiGroup {
	emoji: string
	names: string[]
	seen: number
}

export function grouped(state: ReactionState): EmojiGroup[] {
	const by = new Map<string, { names: string[]; seen: number }>()
	for (const voter of Object.values(state.v)) {
		if (!voter.e) continue
		let g = by.get(voter.e)
		if (!g) {
			g = { names: [], seen: 0 }
			by.set(voter.e, g)
		}
		g.names.push(voter.n || 'unknown')
		if (voter.t > g.seen) g.seen = voter.t
	}
	return [...by.entries()]
		.map(([emoji, g]) => ({ emoji, names: g.names.sort(), seen: g.seen }))
		.sort((a, b) => b.names.length - a.names.length || b.seen - a.seen)
}

// Inline footer - counts only, names live behind the button.
export function footerText(state: ReactionState): string {
	const groups = grouped(state)
	if (groups.length === 0) return ''
	return '\n\n' + groups.map((g) => `${g.emoji} ${g.names.length}`).join('   ')
}

export function detailText(state: ReactionState): string {
	const groups = grouped(state)
	const total = Object.keys(state.v).length
	const lines = groups.map((g) => {
		const shown = g.names.slice(0, MAX_NAMES).join(', ')
		const more = g.names.length > MAX_NAMES ? ` +${g.names.length - MAX_NAMES} more` : ''
		return `${g.emoji} ${g.names.length} - ${shown}${more}`
	})
	return `Reactions (${total})\n${lines.join('\n')}`
}

function viewButton(targetTgId: number, total: number): object | undefined {
	if (!total || !targetTgId) return undefined
	return {
		reply_markup: {
			inline_keyboard: [[{
				text: `View reactions (${total})`,
				callback_data: `rx:${targetTgId}`,
			}]],
		},
	}
}

// One logical update per mirror at a time - rapid reactions serialize
// instead of racing the Telegram edits.
const chains = new Map<string, Promise<void>>()

function chained(key: string, fn: () => Promise<void>): Promise<void> {
	const prev = chains.get(key) || Promise.resolve()
	const next = prev.then(fn).catch((e) => console.error('[BRIDGE] reaction update failed:', e))
	chains.set(key, next)
	next.finally(() => {
		if (chains.get(key) === next) chains.delete(key)
	}).catch(() => null)
	return next
}

function authorOf(m: proto.IWebMessageInfo): { key: string; name: string } {
	const participantRaw = m.key?.participant
	const participant = participantRaw ? stripDevice(normalizeJid(participantRaw)) : ''
	if (participant) {
		return {
			key: participant,
			name: m.key?.fromMe ? 'You' : (m.pushName || phoneOf(participantRaw) || 'unknown'),
		}
	}
	if (m.key?.fromMe) return { key: 'me', name: 'You' }
	const chat = stripDevice(normalizeJid(m.key?.remoteJid))
	return { key: chat || 'unknown', name: m.pushName || phoneOf(m.key?.remoteJid) || 'unknown' }
}

// LID/PN identity twins for sealed-envelope auth - mirrors secret-edits.ts:
// WA may seal with either identity, GCM cleanly rejects the wrong one.
async function encReactionSenders(raw: string): Promise<string[]> {
	const out = new Set<string>()
	const base = stripDevice(raw)
	if (base) out.add(base)
	try {
		const map = (bot.sock as any)?.signalRepository?.lidMapping
		const pn = await map?.getPNForLID?.(base)
		const lid = await map?.getLIDForPN?.(base)
		for (const j of [pn, lid]) {
			const n = normalizeJid(typeof j === 'string' ? j : '')
			if (n) out.add(stripDevice(n))
		}
	} catch {
		// Twins unknown - the bare identity still usually verifies.
	}
	return [...out]
}

export interface EncReactionContext {
	targetMsgId: string
	targetSenders: string[]
	reactors: string[]
	secret: Uint8Array
}

// Candidate HKDF labels for the reaction seal - WhatsApp documents none of
// these; 'Poll Vote' / 'Event Response' / 'Message Edit' are the known
// siblings, so 'Reaction' goes first with close variants as fallback. GCM
// auth rejects wrong labels, so trying several is safe.
const ENC_REACTION_LABELS = ['Reaction', 'Reaction Message', 'Message Reaction', 'React']

// Decrypt an encReactionMessage envelope against the target message's
// messageSecret. Returns the emoji text ('' = removal) on success, null when
// nothing verifies (unknown label, missing secret, corrupt payload).
export function decryptEncReaction(
	encPayload: Uint8Array,
	encIv: Uint8Array,
	ctx: EncReactionContext,
): string | null {
	try {
		if (!encPayload?.length || encIv?.length !== 12) return null
		if (!ctx.targetMsgId || !ctx.secret?.length) return null
		const senders = [...new Set(ctx.targetSenders.filter(Boolean))]
		const reactors = [...new Set(ctx.reactors.filter(Boolean))]
		if (senders.length === 0 || reactors.length === 0) return null
		for (const label of ENC_REACTION_LABELS) {
			for (const orig of senders) {
				for (const reactor of reactors) {
					const aads: Uint8Array[] = [
						Buffer.from(`${ctx.targetMsgId}\0${reactor}`),
						new Uint8Array(0),
					]
					for (const aad of aads) {
						try {
							const sign = Buffer.concat([
								Buffer.from(ctx.targetMsgId),
								Buffer.from(orig),
								Buffer.from(reactor),
								Buffer.from(label),
								new Uint8Array([1]),
							])
							const key0 = hmacSign(ctx.secret, new Uint8Array(32), 'sha256')
							const decKey = hmacSign(sign, key0, 'sha256')
							const plain = aesDecryptGCM(encPayload, decKey, encIv, aad)
							const dec = proto.Message.ReactionMessage.decode(plain)
							if (typeof dec?.text === 'string') return dec.text
						} catch {
							// Wrong label/identity/AAD mix - try the next one.
						}
					}
				}
			}
		}
		return null
	} catch {
		return null
	}
}

// Encrypted reaction carrier -> decrypt against the stored target secret,
// then replay through the normal reaction path. Anything undecryptable
// (unknown seal label, secret never stored) drops silently - a lost emoji is
// not worth a Telegram warning. Resolves its own mirror, no topic is created.
export async function handleWaEncReaction(m: proto.IWebMessageInfo, node: any): Promise<void> {
	const { db } = relayCtx
	if (!db) return
	try {
		const targetKey = node?.targetMessageKey
		const targetId = targetKey?.id
		if (!targetId || !m.key) return
		if (!m.key.remoteJid || m.key.remoteJid === 'status@broadcast') return
		const cands = candidatesOf(m.key)
		const mapping = cands.map((c) => db.getByJidOrAlias(c)).find((x) =>
			x && !x.archived && !x.muted
		)
		if (!mapping) return
		const entry = db.getByWaMsgIdAny(targetId, [mapping.whatsapp_jid, ...cands])
		const secret = entry?.wa_msg_secret ? Buffer.from(entry.wa_msg_secret) : null
		if (!entry || !secret?.length) {
			console.debug(
				`[BRIDGE] encReaction without stored secret, target ${targetId} - dropped`,
			)
			return
		}
		const me = selfJid()
		const reactorBase = m.key.fromMe ? me : stripDevice(m.key.participant || m.key.remoteJid)
		const targetBase = stripDevice(targetKey.participant || targetKey.remoteJid || '')
		const text = decryptEncReaction(node.encPayload, node.encIv, {
			targetMsgId: targetId,
			targetSenders: await encReactionSenders(targetBase),
			reactors: await encReactionSenders(reactorBase || me),
			secret,
		})
		if (text === null) {
			console.debug(`[BRIDGE] encReaction undecryptable, target ${targetId} - dropped`)
			return
		}
		await handleWaReactionCarrier(m, { text, key: targetKey })
	} catch (e) {
		console.error('[BRIDGE] failed to relay one WA encrypted reaction:', e)
	}
}

// Chunked long texts save one row per chunk under the same WA id - the
// footer belongs on the newest editable chunk, never scattered across all.
function pickTarget(rows: ReplyMapRow[]): ReplyMapRow | undefined {
	if (rows.length === 0) return undefined
	const editable = rows.filter((r) => r.tg_kind === 'text' || r.tg_kind === 'media')
	const pool = editable.length > 0 ? editable : rows
	return pool.reduce((a, b) => (b.tg_msg_id > a.tg_msg_id ? b : a))
}

function popularEmoji(state: ReactionState): string | null {
	const groups = grouped(state)
	return groups.length > 0 ? groups[0].emoji : null
}

async function setNativeReaction(
	chatId: string,
	tgMsgId: number,
	state: ReactionState,
): Promise<void> {
	const popular = popularEmoji(state)
	try {
		await applyTgReaction(chatId, tgMsgId, popular ? waReactionToTgEmoji(popular) : null)
	} catch (e) {
		console.error('[BRIDGE] failed to set popular reaction:', e)
	}
}

async function deleteSummary(chatId: string, summaryId: number | null): Promise<void> {
	if (!summaryId) return
	const { tg } = relayCtx
	if (!tg) return
	try {
		await tgCall(() => tg!.api.deleteMessage(chatId, summaryId), 'delete', chatId)
	} catch {
		// Summary already gone - nothing to clean.
	}
}

// Reaction carrier -> roster update plus footer render. The carrier key is
// the REACTION message itself; the target lives in node.key.id.
export async function handleWaReactionCarrier(m: proto.IWebMessageInfo, node: any): Promise<void> {
	const { db, tg, groups } = relayCtx
	if (!db || !tg) return
	try {
		const targetId = node?.key?.id
		if (!targetId || !m.key) return
		if (!m.key.remoteJid || m.key.remoteJid === 'status@broadcast') return
		const cands = candidatesOf(m.key)
		const mapping = cands.map((c) => db.getByJidOrAlias(c)).find((x) =>
			x && !x.archived && !x.muted
		)
		if (!mapping) return
		const raw = typeof node.text === 'string' ? node.text : null
		const emoji = cleanReactionEmoji(raw)
		// Echo of our own TG-TO-WA react (marked before the WA send) - the
		// mark uses the row JID, so consume it the same way. Try the raw
		// text first, then the grouped form.
		if (db.takeTgReact(mapping.whatsapp_jid, targetId, raw ?? '')) return
		if (
			(raw ?? '') !== emoji && emoji && db.takeTgReact(mapping.whatsapp_jid, targetId, emoji)
		) return
		const rows: ReplyMapRow[] = cands.flatMap((c) => db.getByWaMsgIdAll(targetId, c))
		const seen = new Map<string, ReplyMapRow>()
		for (const r of rows) seen.set(`${r.tg_chat_id}:${r.tg_msg_id}`, r)
		const target = pickTarget([...seen.values()])
		if (!target) return
		const chatId = chatForReply(target, mapping, groups)
		const mirrorId = target.tg_msg_id
		const author = authorOf(m)
		await chained(`${chatId}:${mirrorId}`, async () => {
			const fresh = db.getReplyMapAt(chatId, mirrorId)
			if (!fresh) return
			const state = parseState((fresh as ReplyMapRow).wa_reactions)
			if (emoji) {
				if (!state.v[author.key] && Object.keys(state.v).length >= MAX_VOTERS) return
				const used = new Set(Object.values(state.v).map((x) => x.e))
				if (!used.has(emoji) && used.size >= MAX_EMOJIS) return
				state.v[author.key] = { n: author.name.slice(0, 64), e: emoji, t: Date.now() }
			} else {
				delete state.v[author.key]
			}
			db.saveReactions(chatId, mirrorId, JSON.stringify(state))
			await renderReactions(chatId, mirrorId)
		})
	} catch (e) {
		console.error('[BRIDGE] failed to relay one WA reaction carrier:', e)
	}
}

// Render the roster onto the mirror (footer plus button) or the fallback
// reply line. Reads the row fresh so chained updates never clobber edits.
export async function renderReactions(chatId: string, mirrorId: number): Promise<void> {
	const { db, tg } = relayCtx
	if (!db || !tg) return
	const row = db.getReplyMapAt(chatId, mirrorId)
	if (!row) return
	const mapping = db.getByJidOrAlias(row.wa_jid)
	if (!mapping || mapping.archived || mapping.muted) return
	const state = parseState((row as ReplyMapRow).wa_reactions)
	const total = Object.keys(state.v).length
	const topicId = mapping.telegram_topic_id
	await setNativeReaction(chatId, mirrorId, state)
	if (total === 0) {
		await restoreMirror(row, state)
		return
	}
	const footer = footerText(state)
	const button = viewButton(mirrorId, total)
	const route = routeEdit((row as ReplyMapRow).tg_kind)
	const base = (row as ReplyMapRow).tg_text || ''
	if (
		(route === 'text' || route === 'caption' || route === 'both') && base &&
		base.length <= INLINE_BASE_MAX
	) {
		if (await editMirrorInline(row, base, footer, button)) {
			if (state.s) {
				const gone = state.s
				state.s = null
				db.saveReactions(chatId, mirrorId, JSON.stringify(state))
				await deleteSummary(chatId, gone)
			}
			return
		}
	}
	await ensureReplyLine(row, footer, button, state, topicId)
}

async function editMirrorInline(
	row: ReplyMapRow,
	base: string,
	footer: string,
	button: object | undefined,
): Promise<boolean> {
	const { db, tg } = relayCtx
	if (!db || !tg) return false
	const chatId = row.tg_chat_id
	const route = routeEdit(row.tg_kind)
	try {
		if (route === 'caption') {
			const caption = (base + footer).slice(0, 1024)
			let captionEntities: object | undefined
			try {
				const parsed: unknown = JSON.parse(row.tg_entities || '[]')
				if (Array.isArray(parsed)) {
					const kept = (parsed as { offset: number; length: number }[]).filter(
						(e) => e.offset + e.length <= base.length,
					)
					if (kept.length > 0) captionEntities = { caption_entities: kept }
				}
			} catch {
				captionEntities = undefined
			}
			await tgCall(
				() =>
					tg!.api.editMessageCaption(chatId, row.tg_msg_id, {
						caption,
						...(captionEntities as object || {}),
						...(button as object || {}),
					}),
				'edit-caption',
				chatId,
			)
			return true
		}
		const full = (base + footer).slice(0, 4096)
		let entities: object | undefined
		try {
			const parsed: unknown = JSON.parse(row.tg_entities || '[]')
			if (Array.isArray(parsed)) {
				const kept = (parsed as { offset: number; length: number }[]).filter(
					(e) => e.offset + e.length <= base.length,
				)
				if (kept.length > 0) entities = { entities: kept }
			}
		} catch {
			entities = undefined
		}
		await tgCall(
			() =>
				tg!.api.editMessageText(chatId, row.tg_msg_id, full, {
					...(entities as object || {}),
					...(button as object || {}),
				}),
			'edit-text',
			chatId,
		)
		return true
	} catch {
		// Too old, not editable, or markup rejected - the caller falls back
		// to the reply line so nothing is lost.
		return false
	}
}

// Compact counts as a reply under a mirror that cannot be edited
// (stickers, polls, long texts). Edited in place while it exists.
async function ensureReplyLine(
	row: ReplyMapRow,
	footer: string,
	button: object | undefined,
	state: ReactionState,
	topicId: number,
): Promise<void> {
	const { db, tg } = relayCtx
	if (!db || !tg) return
	const chatId = row.tg_chat_id
	const body = `Reactions${footer}`
	// Best effort: the mirror itself gets the viewer button when the
	// platform allows markup on its kind (harmless when rejected).
	try {
		if (button) {
			await tgCall(
				() =>
					tg!.api.editMessageReplyMarkup(
						chatId,
						row.tg_msg_id,
						(button as any).reply_markup,
					),
				'keyboard',
				chatId,
			)
		} else {
			await tgCall(
				() => tg!.api.editMessageReplyMarkup(chatId, row.tg_msg_id, undefined),
				'keyboard',
				chatId,
			)
		}
	} catch {
		// Polls and old messages reject markup - the reply line below
		// still carries the button.
	}
	if (state.s) {
		try {
			await tgCall(
				() =>
					tg!.api.editMessageText(
						chatId,
						state.s!,
						body,
						(button as object || {}) as any,
					),
				'edit-text',
				chatId,
			)
			return
		} catch {
			// Summary lost - fall through and post fresh.
		}
	}
	try {
		const sent = await tgCall(
			() =>
				tg!.api.sendMessage(chatId, body, {
					message_thread_id: topicId,
					reply_parameters: {
						message_id: row.tg_msg_id,
						allow_sending_without_reply: true,
					},
					...(button as object || {}),
				}),
			'message',
			chatId,
		)
		state.s = (sent as { message_id: number }).message_id
		db.saveReactions(chatId, row.tg_msg_id, JSON.stringify(state))
	} catch (e) {
		console.error('[BRIDGE] failed to post reaction line:', shortErr(e))
		await notifyTopic(chatId, topicId, `Reactions: ${footer.trim()}`)
	}
}

// Last reactor removed - restore the plain mirror and drop the line.
async function restoreMirror(row: ReplyMapRow, state: ReactionState): Promise<void> {
	const { db, tg } = relayCtx
	if (!db || !tg) return
	const chatId = row.tg_chat_id
	await setNativeReaction(chatId, row.tg_msg_id, state)
	if (state.s) await deleteSummary(chatId, state.s)
	state.s = null
	db.saveReactions(chatId, row.tg_msg_id, JSON.stringify(state))
	const base = row.tg_text
	const route = routeEdit(row.tg_kind)
	try {
		if (route === 'caption' && base) {
			await tgCall(
				() =>
					tg!.api.editMessageCaption(chatId, row.tg_msg_id, {
						caption: base.slice(0, 1024),
					}),
				'edit-caption',
				chatId,
			)
		} else if ((route === 'text' || route === 'both') && base) {
			await tgCall(
				() => tg!.api.editMessageText(chatId, row.tg_msg_id, base),
				'edit-text',
				chatId,
			)
		}
	} catch {
		// Mirror too old to restore - the footer stays as history.
	}
	try {
		await tgCall(
			() => tg!.api.editMessageReplyMarkup(chatId, row.tg_msg_id, undefined),
			'keyboard',
			chatId,
		)
	} catch {
		// Markup already gone or unsupported - nothing to strip.
	}
}

// Re-apply the footer after a WA text edit replaced the mirror content.
// edits.ts stores the fresh base first, then calls here.
export async function reapplyReactions(chatId: string, mirrorId: number): Promise<void> {
	const { db } = relayCtx
	if (!db) return
	const row = db.getReplyMapAt(chatId, mirrorId)
	if (!row) return
	const state = parseState((row as ReplyMapRow).wa_reactions)
	if (Object.keys(state.v).length === 0) return
	await chained(`${chatId}:${mirrorId}`, async () => {
		await renderReactions(chatId, mirrorId)
	})
}

// Drop the roster and its reply line before a delete/tombstone replaces
// the mirror. Safe when the row is already gone.
export async function clearReactions(chatId: string, mirrorId: number): Promise<void> {
	const { db, tg } = relayCtx
	if (!db || !tg) return
	try {
		const row = db.getReplyMapAt(chatId, mirrorId)
		if (!row) return
		const state = parseState((row as ReplyMapRow).wa_reactions)
		if (state.s) await deleteSummary(chatId, state.s)
		db.saveReactions(chatId, mirrorId, null)
		try {
			await tgCall(
				() => tg!.api.editMessageReplyMarkup(chatId, mirrorId, undefined),
				'keyboard',
				chatId,
			)
		} catch {
			// Markup already gone - nothing to strip.
		}
	} catch (e) {
		console.error('[BRIDGE] failed to clear reactions:', shortErr(e))
	}
}

// Viewer button - stateless `rx:<mirrorId>`, so restarts never break it.
// Short rosters answer as an alert; long ones land as a topic reply.
export function registerReactionViewHandler(tg: Bot, groups: GroupIds): void {
	tg.callbackQuery(/^rx:(\d+)$/, async (ctx) => {
		try {
			if (ctx.from?.is_bot) return
			const chatId = String(ctx.chat?.id ?? '')
			if (!chatId || bucketOfChat(chatId, groups) === null) {
				await ctx.answerCallbackQuery({ text: 'Unknown group.' }).catch(() => null)
				return
			}
			const targetId = Number(ctx.match?.[1])
			if (!Number.isFinite(targetId) || targetId <= 0) {
				await ctx.answerCallbackQuery({ text: 'Reactions expired.' }).catch(() => null)
				return
			}
			const { db } = relayCtx
			if (!db) {
				await ctx.answerCallbackQuery({ text: 'Reactions unavailable.' }).catch(() => null)
				return
			}
			const row = db.getReplyMapAt(chatId, targetId)
			const state = parseState(row ? (row as ReplyMapRow).wa_reactions : null)
			if (!row || Object.keys(state.v).length === 0) {
				await ctx.answerCallbackQuery({ text: 'No reactions any more.' }).catch(() => null)
				return
			}
			const text = detailText(state)
			if (text.length <= ALERT_CHARS) {
				await ctx.answerCallbackQuery({ text, show_alert: true }).catch(() => null)
				return
			}
			await ctx.answerCallbackQuery().catch(() => null)
			const mapping = db.getByJid(row.wa_jid)
			await tgCall(
				() =>
					tg.api.sendMessage(chatId, text.slice(0, 1000), {
						message_thread_id: mapping?.telegram_topic_id,
						reply_parameters: {
							message_id: targetId,
							allow_sending_without_reply: true,
						},
					}),
				'message',
				chatId,
			).catch(() => null)
		} catch (e) {
			console.error('[BRIDGE] reaction view failed:', e)
		}
	})
}

// Refresh the stored mirror base after a WA edit (footer excluded).
export function storeMirrorBase(row: ReplyMapRow, body: string, entities: unknown): void {
	const { db } = relayCtx
	if (!db) return
	let entitiesJson: string | null = null
	try {
		entitiesJson = Array.isArray(entities) && entities.length > 0
			? JSON.stringify(entities)
			: null
	} catch {
		entitiesJson = null
	}
	db.updateMirrorBase(row.tg_chat_id, row.tg_msg_id, storedText(body), entitiesJson)
}
