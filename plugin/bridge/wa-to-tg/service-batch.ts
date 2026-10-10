// Group service batching - membership bursts join into one line.
//
// Mass adds (or join/leave flaps) arrive as one event per change and each
// used to cost its own Telegram send. Events for one chat wait out a short
// window and cross as a single service line, silent when the batch holds
// only joins and exits. Same shed label as before, so deep backlogs still
// drop these first and payload keeps flowing.
import { limiterFor, relayCtx, tgCall } from './state.ts'
import { isQueueDrop } from '../rate-limiter.ts'
import { chatForMapping } from './routing.ts'

function baseWindowMs(): number {
	const raw = Number(Deno.env.get('BRIDGE_SERVICE_BATCH_MS') || '')
	return Number.isFinite(raw) && raw >= 0 ? raw : 3000
}

// Joins and exits usually arrive in flurries (invites, rejoins); widen the
// window while the lane is under pressure so the flurry lands as one line.
function windowFor(chatId: string): number {
	const base = baseWindowMs()
	try {
		const pressure = limiterFor(chatId)?.pressure ?? 0
		if (pressure >= 100) return Math.max(base, 8000)
		if (pressure >= 20) return Math.max(base, 5000)
	} catch {
		// Pressure read failed - fall back to the base window.
	}
	return base
}

interface ServiceAcc {
	adds: string[]
	removes: string[]
	promotes: string[]
	demotes: string[]
	timer: ReturnType<typeof setTimeout>
}

const pendingService = new Map<string, ServiceAcc>()

// Pure line builder: one service line per non-empty bucket, in stable
// order. Exported for targeted smokes; flushService is the only caller.
export function serviceLines(acc: Pick<ServiceAcc, 'adds' | 'removes' | 'promotes' | 'demotes'>): {
	body: string
	silent: boolean
} {
	const lines: string[] = []
	if (acc.adds.length > 0) lines.push(`👋 ${acc.adds.join(', ')} joined the group`)
	if (acc.removes.length > 0) lines.push(`🚪 ${acc.removes.join(', ')} left the group`)
	if (acc.promotes.length > 0) lines.push(`⭐ ${acc.promotes.join(', ')} is now an admin`)
	if (acc.demotes.length > 0) lines.push(`◽ ${acc.demotes.join(', ')} is no longer an admin`)
	// Batches with only joins and exits stay silent (no notification
	// ping); any admin change notifies normally.
	return { body: lines.join('\n'), silent: acc.promotes.length === 0 && acc.demotes.length === 0 }
}

// Buffer one group-participants event for its chat. Unknown actions and
// unmapped, muted or archived chats are dropped, as before.
export function bufferServiceEvent(jid: string, action: string, names: string[]): void {
	const { db, limiter, tg } = relayCtx
	if (!db || !limiter || !tg || names.length === 0) return
	if (action !== 'add' && action !== 'remove' && action !== 'promote' && action !== 'demote') {
		return
	}
	const mapping = db.getByJidOrAlias(jid)
	if (!mapping || mapping.archived || mapping.muted) return
	const home = chatForMapping(mapping, relayCtx.groups)
	let acc = pendingService.get(jid)
	if (!acc) {
		const timer = setTimeout(() => {
			void flushService(jid).catch((e) => console.error('[BRIDGE] service flush failed:', e))
		}, windowFor(home))
		acc = { adds: [], removes: [], promotes: [], demotes: [], timer }
		pendingService.set(jid, acc)
	} else {
		clearTimeout(acc.timer)
		acc.timer = setTimeout(() => {
			void flushService(jid).catch((e) => console.error('[BRIDGE] service flush failed:', e))
		}, windowFor(home))
	}
	if (action === 'add') acc.adds.push(...names)
	else if (action === 'remove') acc.removes.push(...names)
	else if (action === 'promote') acc.promotes.push(...names)
	else acc.demotes.push(...names)
}

export async function flushService(jid: string): Promise<void> {
	const acc = pendingService.get(jid)
	if (!acc) return
	pendingService.delete(jid)
	clearTimeout(acc.timer)
	const { db, limiter, tg, groups } = relayCtx
	if (!db || !limiter || !tg) return
	const mapping = db.getByJidOrAlias(jid)
	if (!mapping || mapping.archived || mapping.muted) return
	const { body, silent } = serviceLines(acc)
	if (!body) return
	const home = chatForMapping(mapping, groups)
	const topic = mapping.telegram_topic_id
	await tgCall(
		() =>
			tg!.api.sendMessage(home, body, {
				message_thread_id: topic,
				...(silent ? { disable_notification: true } : {}),
			}),
		'service-line',
		home,
	).catch((e) => {
		// Load-shed during deep backlogs - membership lines are droppable.
		if (!isQueueDrop(e)) console.error('[BRIDGE] failed to relay group participants:', e)
	})
}
