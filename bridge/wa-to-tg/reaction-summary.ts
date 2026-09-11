// WhatsApp reaction summary - every reactor with their emoji in one place.
//
// Telegram bots get one reaction per message, so concurrent WA reactors are
// last-writer-wins on the mirror itself - this keeps an author-attributed
// summary message beside it (`thumbsup 2 - Alice, Bob`) that is edited on
// each change and deleted when empty. Authors come from the reactionMessage
// upsert carrier (pushName/participant); the messages.reaction event carries
// no author at all. Off by default (BRIDGE_REACTION_SUMMARY) - relay.ts
// skips that event while this path owns the carriers, so nothing is double
// counted.
import { applyTgReaction, waReactionToTgEmoji } from './reactions.ts'
import { notifyTopic, relayCtx, tgCall } from './state.ts'
import { chatForReply } from './routing.ts'
import { candidatesOf } from './jid.ts'
import { phoneOf } from './text.ts'
import type { proto } from 'baileys'

// Multi-reaction summary mode - off by default, last-writer-wins reacts.
const flag = (Deno.env.get('BRIDGE_REACTION_SUMMARY') || '').toLowerCase()
export const reactionSummaryMode = flag === '1' || flag === 'true'

interface EmojiEntry {
	authors: Set<string>
	lastSeen: number
}

interface ReactionSet {
	counts: Map<string, EmojiEntry>
	summaryChatId: string | null
	summaryTgId: number | null
}

// Live reaction sets by chat + target message. Lost on restart - the next
// reaction rebuilds (a stale summary id falls back to posting fresh).
const sets = new Map<string, ReactionSet>()
const MAX_SETS = 200
const MAX_AUTHORS_PER_LINE = 10

// Summary body - one line per emoji, busiest first:
// thumbsup 2 - Alice, Bob
// heart 1 - Dave
function summaryText(counts: Map<string, EmojiEntry>): string {
	return [...counts.entries()]
		.filter(([, e]) => e.authors.size > 0)
		.sort((a, b) => b[1].authors.size - a[1].authors.size || b[1].lastSeen - a[1].lastSeen)
		.map(([emoji, e]) => {
			const authors = [...e.authors]
			const shown = authors.slice(0, MAX_AUTHORS_PER_LINE).join(', ')
			const more = authors.length > MAX_AUTHORS_PER_LINE
				? ` +${authors.length - MAX_AUTHORS_PER_LINE} more`
				: ''
			return `${emoji} ${e.authors.size} - ${shown}${more}`
		})
		.join('\n')
}

// Reaction carrier -> tracked set + popular emoji on the mirror + edited
// summary. The carrier key is the REACTION message itself; the target lives
// in node.key.id.
export async function handleWaReactionCarrier(
	m: proto.IWebMessageInfo,
	node: any,
): Promise<void> {
	const { db, limiter, tg, groups } = relayCtx
	if (!db || !limiter || !tg) return
	try {
		const targetId = node?.key?.id
		if (!targetId || !m.key) return
		if (!m.key.remoteJid || m.key.remoteJid === 'status@broadcast') return
		const cands = candidatesOf(m.key)
		const mapping = cands.map((c) => db.getByJidOrAlias(c)).find((m) =>
			m && !m.archived && !m.muted
		)
		if (!mapping) return
		const emoji = waReactionToTgEmoji(typeof node.text === 'string' ? node.text : null)
		// Echo of our own TG-TO-WA react (marked before the WA send) - same
		// mark the messages.reaction path consumes.
		if (db.takeTgReact(mapping.whatsapp_jid, targetId, emoji ?? '')) return
		const target = db.getByWaMsgIdAny(targetId, [mapping.whatsapp_jid, ...cands])
		if (!target) return
		// Name first, never a bare LID - own reactions are You.
		const author = m.key.fromMe
			? 'You'
			: (m.pushName || phoneOf(m.key.participant) || 'unknown')
		const chatId = chatForReply(target, mapping, groups)
		const key = `${mapping.whatsapp_jid}\n${targetId}`
		let set = sets.get(key)
		if (!set) {
			set = { counts: new Map(), summaryChatId: null, summaryTgId: null }
			if (sets.size >= MAX_SETS) {
				const oldest = sets.keys().next().value
				if (oldest !== undefined) sets.delete(oldest)
			}
			sets.set(key, set)
		}
		if (emoji) {
			let e = set.counts.get(emoji)
			if (!e) {
				e = { authors: new Set(), lastSeen: 0 }
				set.counts.set(emoji, e)
			}
			e.authors.add(author)
			e.lastSeen = Date.now()
		} else {
			// Removals carry no emoji - clear the author everywhere.
			for (const e of set.counts.values()) e.authors.delete(author)
		}
		// Most popular emoji stays on the mirror itself (ties break toward
		// the most recent); null clears it when nobody is left.
		let popular: string | null = null
		let best = 0
		let bestSeen = -1
		for (const [em, e] of set.counts) {
			if (e.authors.size === 0) continue
			if (e.authors.size > best || (e.authors.size === best && e.lastSeen > bestSeen)) {
				popular = em
				best = e.authors.size
				bestSeen = e.lastSeen
			}
		}
		try {
			await applyTgReaction(chatId, target.tg_msg_id, popular)
		} catch (e) {
			console.error('[BRIDGE] failed to set popular reaction:', e)
		}
		const text = summaryText(set.counts)
		if (!text) {
			const sumChat = set.summaryChatId
			const sumId = set.summaryTgId
			sets.delete(key)
			if (sumChat && sumId != null) {
				try {
					await tgCall(() => tg!.api.deleteMessage(sumChat, sumId), 'delete')
				} catch {
					// Summary already gone - nothing to clean.
				}
			}
			return
		}
		const sumChat = set.summaryChatId
		const sumId = set.summaryTgId
		if (sumChat && sumId != null) {
			try {
				// No thread param - the message already lives in its topic.
				await tgCall(() => tg!.api.editMessageText(sumChat, sumId, text), 'edit-text')
				return
			} catch {
				// Summary lost (restart, manual delete) - fall through and
				// post fresh below.
			}
		}
		try {
			const sent = await tgCall(() =>
				tg!.api.sendMessage(chatId, text, {
					message_thread_id: mapping.telegram_topic_id,
					reply_parameters: {
						message_id: target.tg_msg_id,
						allow_sending_without_reply: true,
					},
				}), 'message')
			set.summaryChatId = chatId
			set.summaryTgId = sent.message_id
		} catch (e) {
			console.error('[BRIDGE] failed to post reaction summary:', e)
			await notifyTopic(
				chatId,
				mapping.telegram_topic_id,
				`⚠️ Couldn't relay reactions: ${text}`,
			)
		}
	} catch (e) {
		console.error('[BRIDGE] failed to relay one WA reaction carrier:', e)
	}
}
