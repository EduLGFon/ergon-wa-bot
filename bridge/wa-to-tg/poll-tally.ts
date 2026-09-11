// WhatsApp poll live tally - one edited message per poll instead of a reply
// per vote.
//
// Every WA poll vote decrypts into (voter, selected options); the roster
// persists in reply_map.wa_poll_tally and renders as a single message
// replied under the poll, edited on each vote:
//   📊 3 votes
//   A — 2 (67%) — You, Alice
//   B — 1 (33%) — Bob
// Echoes of our own TG-TO-WA votes pass through unchanged - applying a
// voter's selection is idempotent, so no echo guard is needed. Deletes the
// tally when the last voter leaves, and re-posts fresh if the tally message
// was lost (restart, manual delete). When no tally message can be created
// the vote still lands as a one-off `🗳️ X voted:` reply line (the old
// per-vote behavior).
import { notifyTopic, relayCtx, shortErr, tgCall } from './state.ts'
import { chatForReply } from './routing.ts'
import type { GroupIds } from './routing.ts'
import type { ReplyMapRow } from '../db.ts'

interface VoterRec {
	name: string
	opts: string[]
}

interface TallyState {
	summaryMsgId: number | null
	voters: Record<string, VoterRec>
}

const MAX_NAMES_PER_LINE = 8

// Roster from row JSON - malformed rows start fresh, the tally just re-posts.
function parseTally(raw: string | null | undefined): TallyState {
	const t: TallyState = { summaryMsgId: null, voters: {} }
	if (!raw) return t
	try {
		const data: unknown = JSON.parse(raw)
		if (typeof data !== 'object' || data === null) return t
		const o = data as Record<string, unknown>
		const v = o.voters
		if (typeof v === 'object' && v !== null) {
			for (const [jid, rec] of Object.entries(v as Record<string, unknown>)) {
				const r = rec as { name?: unknown; opts?: unknown }
				if (typeof r?.name !== 'string' || !Array.isArray(r.opts)) continue
				const opts = r.opts.filter((x): x is string => typeof x === 'string')
				t.voters[jid] = { name: r.name, opts }
			}
		}
		if (typeof o.summaryMsgId === 'number' && o.summaryMsgId > 0) {
			t.summaryMsgId = o.summaryMsgId
		}
	} catch {
		// Start fresh.
	}
	return t
}

// Tally body - one line per option, busiest first. The denominator is the
// number of voters, so multi-choice votes can exceed 100% summed (matching
// WhatsApp). Empty when nobody voted.
export function renderTally(options: string[], t: TallyState): string {
	const voters = Object.values(t.voters).filter((v) => v.opts.length > 0)
	if (voters.length === 0) return ''
	const total = voters.length
	const rows: Array<{ count: number; index: number; line: string }> = options
		.map((opt, index) => {
			const who = voters.filter((v) => v.opts.includes(opt)).map((v) => v.name).sort()
			const count = who.length
			if (count === 0) return { count, index, line: `${opt} — 0 (0%)` }
			const pct = Math.round((count * 100) / total)
			const shown = who.slice(0, MAX_NAMES_PER_LINE).join(', ')
			const more = who.length > MAX_NAMES_PER_LINE
				? ` +${who.length - MAX_NAMES_PER_LINE} more`
				: ''
			return { count, index, line: `${opt} — ${count} (${pct}%) — ${shown}${more}` }
		})
		.sort((a, b) => b.count - a.count || a.index - b.index)
	return `📊 ${total} vote${total === 1 ? '' : 's'}\n${rows.map((r) => r.line).join('\n')}`
}

// Apply one decrypted vote to the roster and update the tally message in
// place. names is the voter's new selection - empty removes the voter.
export async function applyPollTally(
	entry: ReplyMapRow,
	mapping: { telegram_chat_id: string; telegram_topic_id: number },
	groups: GroupIds,
	voterJid: string,
	voterName: string,
	names: string[],
): Promise<void> {
	const { db, tg } = relayCtx
	if (!db || !tg) return
	let options: string[] = []
	try {
		const parsed: unknown = JSON.parse(entry.wa_poll_options || '[]')
		if (Array.isArray(parsed)) options = parsed.filter((o) => typeof o === 'string')
	} catch {
		options = []
	}
	if (options.length === 0) return
	const t = parseTally(entry.wa_poll_tally)
	if (names.length === 0) {
		delete t.voters[voterJid]
	} else {
		const prev = t.voters[voterJid]
		t.voters[voterJid] = {
			name: voterName && voterName !== 'unknown' ? voterName : prev?.name || voterName,
			opts: names,
		}
	}
	const body = renderTally(options, t)
	const chatId = chatForReply(entry, mapping, groups)
	const threadId = mapping.telegram_topic_id
	if (!body) {
		const gone = t.summaryMsgId
		t.summaryMsgId = null
		db.savePollTally(entry.tg_chat_id, entry.tg_msg_id, null)
		if (gone != null) {
			try {
				await tgCall(() => tg!.api.deleteMessage(chatId, gone), 'delete')
			} catch {
				// Tally already gone - nothing to clean.
			}
		}
		return
	}
	if (t.summaryMsgId != null) {
		try {
			await tgCall(
				() => tg!.api.editMessageText(chatId, t.summaryMsgId!, body),
				'edit-text',
			)
			db.savePollTally(entry.tg_chat_id, entry.tg_msg_id, JSON.stringify(t))
			return
		} catch {
			// Tally lost (restart, manual delete) - fall through and post fresh.
		}
	}
	try {
		const sent = await tgCall(
			() =>
				tg!.api.sendMessage(chatId, body, {
					message_thread_id: threadId,
					reply_parameters: {
						message_id: entry.tg_msg_id,
						allow_sending_without_reply: true,
					},
				}),
			'message',
		)
		t.summaryMsgId = sent.message_id
		db.savePollTally(entry.tg_chat_id, entry.tg_msg_id, JSON.stringify(t))
	} catch (e) {
		console.error('[BRIDGE] failed to post poll tally:', shortErr(e))
		// No tally message possible - don't lose the vote. Fall back to a
		// one-off reply line under the poll (the old per-vote behavior).
		if (names.length > 0) {
			try {
				await tgCall(
					() =>
						tg!.api.sendMessage(chatId, `🗳️ ${voterName} voted: ${names.join(', ')}`, {
							message_thread_id: threadId,
							reply_parameters: {
								message_id: entry.tg_msg_id,
								allow_sending_without_reply: true,
							},
						}),
					'poll-vote',
				)
				return
			} catch (e2) {
				console.error('[BRIDGE] poll-vote fallback failed:', shortErr(e2))
			}
		}
		await notifyTopic(
			chatId,
			threadId,
			`⚠️ Couldn't relay votes: ${body.split('\n').slice(0, 3).join('\n')}`,
		)
	}
}
