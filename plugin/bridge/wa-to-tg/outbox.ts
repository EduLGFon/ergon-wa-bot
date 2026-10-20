// Durable overflow replay - drains WA messages parked after queue load-shed.
//
// The Telegram queue is the only bounded stage in the relay; without this a
// sustained burst loses messages after the parked producers time out. Drops
// are stored as encoded WebMessageInfo BLOBs (media keys and context survive
// the protobuf round-trip) and replayed oldest-first once both Telegram lanes
// are quiet. Replay goes through the normal incoming pipeline, so mapping,
// dedupe, media re-download and notices behave exactly like a fresh message.
import { proto } from 'baileys'
import { handleWAMessages } from './incoming.ts'
import { isQueueDrop } from '../rate-limiter.ts'
import { relayCtx } from './state.ts'

const TICK_MS = 15_000
const MAX_REPLAY_PER_TICK = 10
const BUSY_DEPTH = 100
const MAX_AGE_MS = 24 * 60 * 60 * 1000
const QUEUE_RETRY_MS = 30_000
const ERROR_RETRY_MS = 5 * 60 * 1000
const MAX_ERROR_ATTEMPTS = 3

let timer: ReturnType<typeof setInterval> | null = null
let draining = false
let active = false

export function startOutboxWorker(): void {
	if (timer) return
	active = true
	timer = setInterval(() => void drainOutbox(), TICK_MS)
	// First attempt is deferred so boot catch-up owns the queue first.
	setTimeout(() => void drainOutbox(), 5_000)
}

export function stopOutboxWorker(): void {
	active = false
	if (timer) clearInterval(timer)
	timer = null
}

export async function drainOutbox(): Promise<void> {
	if (!active || draining) return
	const { db, limiter, businessLimiter } = relayCtx
	if (!db || !limiter) return
	const businessBusy = businessLimiter && businessLimiter !== limiter &&
		businessLimiter.depth > BUSY_DEPTH
	if (limiter.depth > BUSY_DEPTH || businessBusy) return

	draining = true
	try {
		let rows: ReturnType<typeof db.listOutbox>
		try {
			rows = db.listOutbox(MAX_REPLAY_PER_TICK)
		} catch (e) {
			console.error('[BRIDGE] outbox: failed to read queue:', e)
			return
		}
		for (const row of rows) {
			if (!active) return
			if (Date.now() - row.created_at > MAX_AGE_MS) {
				db.deleteOutbox(row.id)
				console.warn(`[BRIDGE] outbox: expired WA message #${row.id} (older than 24h)`)
				continue
			}
			let m: proto.IWebMessageInfo
			try {
				m = proto.WebMessageInfo.decode(row.wa_msg)
			} catch (e) {
				db.deleteOutbox(row.id)
				console.error(`[BRIDGE] outbox: undecodable WA message #${row.id}:`, e)
				continue
			}
			try {
				await handleWAMessages([m], { fromOutbox: true })
				if (active) db.deleteOutbox(row.id)
			} catch (e) {
				if (!active) return
				if (isQueueDrop(e)) {
					// The lane filled again while replaying - keep the row and
					// stop here so ordering stays oldest-first.
					db.deferOutbox(row.id, Date.now() + QUEUE_RETRY_MS)
					break
				}
				console.error(`[BRIDGE] outbox: replay failed for WA message #${row.id}:`, e)
				if (row.attempts + 1 >= MAX_ERROR_ATTEMPTS) {
					db.deleteOutbox(row.id)
				} else {
					db.deferOutbox(row.id, Date.now() + ERROR_RETRY_MS)
				}
			}
		}
	} finally {
		draining = false
	}
}
