// WhatsApp call relay - live call lifecycle as one editable notice.
//
// Baileys emits `call` events (offer/ringing/accept/reject/timeout/
// terminate) with no message behind them - this coalesces each call id into
// a single topic message that is edited as the call progresses, so one call
// never sprays one line per signaling state. Transport states are skipped;
// terminal states close the notice with a duration or a missed line.
import { canonicalChatJid, selfJid, stripDevice } from './jid.ts'
import { notifyTopic, relayCtx, shortErr, tgCall } from './state.ts'
import { chatForMapping } from './routing.ts'
import type { WACallEvent } from 'baileys'
import { phoneOf } from './text.ts'

interface CallState {
	chatId: string
	topicId: number
	tgMsgId: number | null
	who: string
	kind: string
	kindCap: string
	bell: string
	outgoing: boolean
	accepted: boolean
	startedAt: number
	lastLine: string
}

// Live calls by Baileys call id. Entries die on terminal states; the cap
// bounds restarts that strand offers without a matching close.
const liveCalls = new Map<string, CallState>()
const MAX_LIVE_CALLS = 50

// Recently closed calls by chat JID - WhatsApp posts a callLogMessage right
// after the live signaling, which would duplicate the notice above. The rich
// fallback drops call logs inside this window and renders older ones (calls
// from before the bridge was watching) as text instead.
const closedCalls = new Map<string, number>()
const CALL_CLOSE_WINDOW_MS = 120_000

function markCallClosed(jid: string): void {
	if (closedCalls.size > 200) {
		const oldest = closedCalls.keys().next().value
		if (oldest !== undefined) closedCalls.delete(oldest)
	}
	closedCalls.set(jid, Date.now())
}

export function wasCallClosedRecently(jid: string): boolean {
	const at = closedCalls.get(jid)
	if (!at) return false
	if (Date.now() - at > CALL_CLOSE_WINDOW_MS) {
		closedCalls.delete(jid)
		return false
	}
	return true
}

// Short call duration - largest two units, e.g. 45s, 2m 30s, 1h 3m.
function fmtDuration(ms: number): string {
	const total = Math.max(0, Math.round(ms / 1000))
	if (total < 60) return `${total}s`
	const m = Math.floor(total / 60)
	if (m < 60) {
		const s = total % 60
		return s > 0 ? `${m}m ${s}s` : `${m}m`
	}
	const h = Math.floor(m / 60)
	const rm = m % 60
	return rm > 0 ? `${h}h ${rm}m` : `${h}h`
}

// Final line for a call that never connected: declined/not-answered when we
// called out, missed when they called us.
function missedLine(s: CallState, noAnswer: boolean): string {
	if (s.outgoing) {
		return noAnswer
			? `${s.bell} ${s.kindCap} to ${s.who} not answered`
			: `${s.bell} ${s.kindCap} to ${s.who} declined`
	}
	return `${s.bell} Missed ${s.kind} from ${s.who}${noAnswer ? ' (no answer)' : ''}`
}

function callLine(s: CallState, status: WACallEvent['status'], now: number): string | null {
	switch (status) {
		case 'offer':
			return s.outgoing
				? `${s.bell} Outgoing ${s.kind} to ${s.who}`
				: `${s.bell} Incoming ${s.kind} from ${s.who}`
		case 'ringing':
		case 'preaccept':
			return `${s.bell} Ringing - ${s.who}`
		case 'accept':
			return `${s.bell} ${s.kindCap} in progress - ${s.who}`
		case 'terminate':
			if (!s.accepted) return missedLine(s, false)
			return `${s.bell} ${s.kindCap} ended - ${s.who} (${fmtDuration(now - s.startedAt)})`
		case 'reject':
		case 'timeout':
			if (s.accepted) {
				return `${s.bell} ${s.kindCap} ended - ${s.who} (${fmtDuration(now - s.startedAt)})`
			}
			return missedLine(s, status === 'timeout')
		default:
			// transport, relaylatency and anything future - internal noise.
			return null
	}
}

async function handleOneCall(ev: WACallEvent): Promise<void> {
	const { db, tg, groups } = relayCtx
	if (!db || !tg) return
	if (!ev || ev.status === 'transport' || ev.status === 'relaylatency') return
	const id = ev.id
	if (!ev.chatId || ev.chatId === 'status@broadcast') {
		if (id) liveCalls.delete(id)
		return
	}
	// Canonicalize LID/PN variants to one chat before the mapping lookup,
	// so a call never misses its topic on addressing mismatch.
	const { canonical: jid, aliases } = await canonicalChatJid({ remoteJid: ev.chatId })
	if (!jid) return
	const cands = [jid, ...aliases]
	const mapping = cands.map((c) => db.getByJidOrAlias(c)).find((m) =>
		m && !m.archived && !m.muted
	)
	if (!mapping) {
		if (id) liveCalls.delete(id)
		return
	}
	const terminal = ev.status === 'reject' || ev.status === 'timeout' || ev.status === 'terminate'
	const me = selfJid()
	const from = stripDevice(ev.from)
	const outgoing = !!me && !!from && from === me
	const isGroup = jid.endsWith('@g.us')
	const peer = mapping.display_name || 'unknown'
	// Outgoing calls are about the peer; incoming 1:1 prefer the saved chat
	// name over the raw number; group callers only have a number.
	const caller = outgoing
		? peer
		: (!isGroup && peer !== 'unknown' ? peer : (phoneOf(ev.callerPn || ev.from) || peer))
	const kind = `${ev.isGroup ? 'group ' : ''}${ev.isVideo ? 'video' : 'voice'} call`
	let state = (id && liveCalls.get(id)) || null
	if (!state) {
		const started = ev.date instanceof Date ? ev.date.getTime() : Date.now()
		state = {
			chatId: chatForMapping(mapping, groups),
			topicId: mapping.telegram_topic_id,
			tgMsgId: null,
			who: caller,
			kind,
			kindCap: kind.charAt(0).toUpperCase() + kind.slice(1),
			bell: ev.offline ? '📴' : '📞',
			outgoing,
			accepted: false,
			startedAt: Number.isFinite(started) ? started : Date.now(),
			lastLine: '',
		}
		if (id) {
			if (liveCalls.size >= MAX_LIVE_CALLS) {
				const oldest = liveCalls.keys().next().value
				if (oldest !== undefined) liveCalls.delete(oldest)
			}
			liveCalls.set(id, state)
		}
	}
	if (ev.status === 'accept') state.accepted = true
	// A lone terminal event (restarted mid-call) still posts its final line
	// as a fresh notice instead of vanishing.
	const line = callLine(state, ev.status, Date.now())
	if (!line || line === state.lastLine) {
		if (terminal && id) liveCalls.delete(id)
		return
	}
	state.lastLine = line
	if (terminal) markCallClosed(jid)
	try {
		if (state.tgMsgId == null) {
			const sent = await tgCall(
				() => tg!.api.sendMessage(state.chatId, line, { message_thread_id: state.topicId }),
				'call',
			)
			state.tgMsgId = sent.message_id
		} else {
			const msgId: number = state.tgMsgId
			await tgCall(() => tg!.api.editMessageText(state.chatId, msgId, line), 'call-edit')
		}
	} catch (e) {
		console.error('[BRIDGE] failed to post one WA call notice:', e)
		await notifyTopic(
			state.chatId,
			state.topicId,
			`⚠️ Couldn't relay a WhatsApp call: ${shortErr(e)}`,
		)
	}
	if (terminal && id) liveCalls.delete(id)
}

// WhatsApp call signaling -> one editable topic notice per call id. Calls
// for unmapped (pre-bridge) chats have no mirror and are skipped.
export async function handleWaCalls(events: WACallEvent[]): Promise<void> {
	const { db, limiter, tg } = relayCtx
	if (!db || !limiter || !tg) return
	for (const ev of events || []) {
		try {
			await handleOneCall(ev)
		} catch (e) {
			console.error('[BRIDGE] failed to relay one WA call:', e)
		}
	}
}
