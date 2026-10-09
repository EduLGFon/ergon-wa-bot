// WhatsApp poll live tally - one edited message per poll instead of a reply
// per vote, now with tap-to-vote plus a voter viewer (see D10).
//
// Every WA poll vote decrypts into (voter, selected options); the roster
// persists in reply_map.wa_poll_tally and renders as a single compact
// message replied under the poll, edited on each vote:
//   📊 3 votes
//   A - 2 (67%)
//   B - 1 (33%)
// Per-option buttons vote directly (tap toggles on multi polls, replaces on
// single ones) and a viewer button reveals who voted what - voter names live
// behind that button instead of inline. Echoes of our own TG-TO-WA votes pass
// through unchanged - applying a voter's selection is idempotent, so no echo
// guard is needed. Deletes the tally when the last voter leaves, and re-posts
// fresh if the tally message was lost (restart, manual delete). When no tally
// message can be created the vote still lands as a one-off reply line.
import { notifyTopic, relayCtx, shortErr, tgCall } from './state.ts'
import { chatForReply } from './routing.ts'
import { selfJid } from './jid.ts'
import type { GroupIds } from './routing.ts'
import type { ReplyMapRow } from '../db.ts'

interface VoterRec {
	name: string
	opts: string[]
}

export interface TallyState {
	summaryMsgId: number | null
	voters: Record<string, VoterRec>
}

const MAX_NAMES_PER_LINE = 8

// Roster from row JSON - malformed rows start fresh, the tally just re-posts.
export function parseTally(raw: string | null | undefined): TallyState {
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

// Stored poll options with the multi flag - new rows store an object,
// rows mirrored before D10 a bare array. Both read the same way.
export function parsePollOptions(
	raw: string | null | undefined,
): { options: string[]; multi: boolean } {
	if (!raw) return { options: [], multi: false }
	try {
		const parsed: unknown = JSON.parse(raw)
		if (Array.isArray(parsed)) {
			return {
				options: parsed.filter((o): o is string => typeof o === 'string'),
				multi: false,
			}
		}
		if (parsed && typeof parsed === 'object') {
			const o = parsed as { options?: unknown; multi?: unknown }
			const options = Array.isArray(o.options)
				? o.options.filter((x): x is string => typeof x === 'string')
				: []
			return { options, multi: o.multi === true }
		}
	} catch {
		// Fall through to empty.
	}
	return { options: [], multi: false }
}

// Tally body - counts only, busiest first. Voter names live behind the
// viewer button (see renderVoterDetail). The denominator is the number of
// voters, so multi-choice votes can exceed 100% summed (matching WhatsApp).
// Empty when nobody voted.
export function renderTally(options: string[], t: TallyState): string {
	const voters = Object.values(t.voters).filter((v) => v.opts.length > 0)
	if (voters.length === 0) return ''
	const total = voters.length
	const rows: Array<{ count: number; index: number; line: string }> = options
		.map((opt, index) => {
			const count = voters.filter((v) => v.opts.includes(opt)).length
			if (count === 0) return { count, index, line: `${opt} - 0 (0%)` }
			const pct = Math.round((count * 100) / total)
			return { count, index, line: `${opt} - ${count} (${pct}%)` }
		})
		.sort((a, b) => b.count - a.count || a.index - b.index)
	return `📊 ${total} vote${total === 1 ? '' : 's'}\n${rows.map((r) => r.line).join('\n')}`
}

// Voter detail for the viewer button - one line per voted option with its
// voters. Short rosters answer as an alert, long ones as a topic reply.
export function renderVoterDetail(options: string[], t: TallyState): string {
	const voters = Object.values(t.voters).filter((v) => v.opts.length > 0)
	const total = voters.length
	const lines = options.map((opt) => {
		const who = voters.filter((v) => v.opts.includes(opt)).map((v) => v.name).sort()
		if (who.length === 0) return `${opt} - 0`
		const shown = who.slice(0, MAX_NAMES_PER_LINE).join(', ')
		const more = who.length > MAX_NAMES_PER_LINE
			? ` +${who.length - MAX_NAMES_PER_LINE} more`
			: ''
		return `${opt} - ${who.length} - ${shown}${more}`
	})
	return `Voters (${total})\n${lines.join('\n')}`
}

// Inline keyboard for the tally: one vote button per option (mirroring the
// TG 10-option cap) with a tick on the owner's picks, plus a voter viewer.
// Stateless callbacks - restarts never break them.
export function buildVoteKeyboard(
	mirrorId: number,
	options: string[],
	ownerOpts: string[],
	total: number,
): object {
	const rows = options.slice(0, 10).map((opt, i) => [{
		text: `${ownerOpts.includes(opt) ? '✓ ' : ''}${opt.slice(0, 28)}`,
		callback_data: `pv:${mirrorId}:${i}`,
	}])
	rows.push([{ text: `👀 Voters (${total})`, callback_data: `pl:${mirrorId}` }])
	return { reply_markup: { inline_keyboard: rows } }
}

// Voters with a live selection - the denominator behind every count.
export function totalOf(t: TallyState): number {
	return Object.values(t.voters).filter((v) => v.opts.length > 0).length
}

// The owner's current picks for tick marks - matched by bare account JID
// (own votes always echo with fromMe, so the key is stable).
export function ownerVoterOpts(t: TallyState): string[] {
	const me = selfJid()
	if (!me) return []
	return t.voters[me]?.opts ?? []
}

// One update per poll at a time - rapid votes serialize instead of racing
// the roster read-modify-write.
const tallyChains = new Map<string, Promise<void>>()

// Apply one decrypted vote to the roster and update the tally message in
// place. names is the voter's new selection - empty removes the voter.
export function applyPollTally(
	entry: ReplyMapRow,
	mapping: { telegram_chat_id: string; telegram_topic_id: number },
	groups: GroupIds,
	voterJid: string,
	voterName: string,
	names: string[],
): Promise<void> {
	const key = `${entry.tg_chat_id}:${entry.tg_msg_id}`
	const prev = tallyChains.get(key) || Promise.resolve()
	const next = prev.then(() =>
		applyPollTallyInner(entry, mapping, groups, voterJid, voterName, names)
	).catch((e) => console.error('[BRIDGE] poll tally update failed:', shortErr(e)))
	tallyChains.set(key, next)
	next.finally(() => {
		if (tallyChains.get(key) === next) tallyChains.delete(key)
	}).catch(() => null)
	return next
}

async function applyPollTallyInner(
	entry: ReplyMapRow,
	mapping: { telegram_chat_id: string; telegram_topic_id: number },
	groups: GroupIds,
	voterJid: string,
	voterName: string,
	names: string[],
): Promise<void> {
	const { db, tg } = relayCtx
	if (!db || !tg) return
	const fresh = db.getReplyMapAt(entry.tg_chat_id, entry.tg_msg_id) ?? entry
	const { options } = parsePollOptions(fresh.wa_poll_options)
	if (options.length === 0) return
	const t = parseTally(fresh.wa_poll_tally)
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
				await tgCall(() => tg!.api.deleteMessage(chatId, gone), 'delete', chatId)
			} catch {
				// Tally already gone - nothing to clean.
			}
		}
		return
	}
	if (t.summaryMsgId != null) {
		const keyboard = buildVoteKeyboard(entry.tg_msg_id, options, ownerVoterOpts(t), totalOf(t))
		try {
			await tgCall(
				() => tg!.api.editMessageText(chatId, t.summaryMsgId!, body, keyboard as object),
				'edit-text',
				chatId,
			)
			db.savePollTally(entry.tg_chat_id, entry.tg_msg_id, JSON.stringify(t))
			return
		} catch {
			// Tally lost (restart, manual delete) - fall through and post fresh.
		}
	}
	try {
		const keyboard = buildVoteKeyboard(entry.tg_msg_id, options, ownerVoterOpts(t), totalOf(t))
		const sent = await tgCall(
			() =>
				tg!.api.sendMessage(chatId, body, {
					message_thread_id: threadId,
					reply_parameters: {
						message_id: entry.tg_msg_id,
						allow_sending_without_reply: true,
					},
					...(keyboard as object),
				}),
			'message',
			chatId,
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
					chatId,
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
