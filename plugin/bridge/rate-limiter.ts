// Outgoing queue for Telegram Bot API calls.
//
// Telegram throttles per-chat (roughly 1 msg/s, ~20 msg/min per group) and
// all forum topics share the same underlying supergroup chat, so ALL
// tg.api.* calls go through ONE global FIFO queue with `limitMs` spacing
// between individual API calls (not per logical message - one logical send
// can be 2-3 API calls: header + sticker, content + follow-up, …).
//
// DM priority: WA 1:1 messages enqueue with `priority=true` and jump ahead
// of queued group traffic (FIFO among themselves), so a DM burst never
// waits behind a group backlog.
//
// Flood handling: when Telegram answers 429, the failing item is retried
// (unbounded) after the server's `retry_after`, and the whole queue pauses
// for that duration. Delivery slows down instead of dropping info - a 429
// never rejects. Without this, every subsequent send also 429s (cascade).
export interface RateLimiterOptions {
	/** Retained for compat; 429 retries are unbounded (never drop). */
	maxRetries?: number
	/** Cap for a single flood wait. Default 120_000 ms. */
	maxWaitMs?: number
	/** Fallback wait when a 429 carries no retry_after. Default 5_000 ms. */
	defaultRetryAfterMs?: number
	/** Extra buffer added on top of the server's retry_after. Default 500 ms. */
	retryBufferMs?: number
}

// Extract Telegram's error description (GrammyError shape or plain string).
export function getErrorDescription(e: unknown): string {
	try {
		if (typeof e === 'string') return e
		const anyErr = e as { description?: unknown; message?: unknown }
		if (typeof anyErr?.description === 'string') return anyErr.description
		if (typeof anyErr?.message === 'string') return anyErr.message
	} catch {
		// fall through to empty
	}
	return ''
}

// Extract Telegram's "retry after N seconds" from a GrammyError (or any
// error shaped like one). Returns seconds, or null when this is not a 429.
export function getRetryAfterSeconds(e: unknown): number | null {
	try {
		const anyErr = e as {
			error_code?: unknown
			parameters?: { retry_after?: unknown }
			description?: unknown
			message?: unknown
		}
		const desc = typeof anyErr?.description === 'string'
			? anyErr.description
			: typeof anyErr?.message === 'string'
			? anyErr.message
			: ''
		// Telegram occasionally returns the flood wait as a 400 instead of a
		// 429 ("too Many Requests: retry after 8"). Treat the description as
		// authoritative either way.
		const fromDesc = /retry after (\d+)/i.exec(desc)
		if (anyErr && anyErr.error_code === 429) {
			const ra = anyErr.parameters?.retry_after
			if (typeof ra === 'number' && Number.isFinite(ra) && ra >= 0) return ra
			if (fromDesc) return Number(fromDesc[1])
			return 0 // 429 without a usable value - caller applies default wait.
		}
		if (fromDesc) return Number(fromDesc[1])
	} catch {
		// fall through to null
	}
	return null
}

const TRANSIENT_CODES = new Set([
	'ECONNRESET',
	'ETIMEDOUT',
	'ECONNREFUSED',
	'EPIPE',
	'ENOTFOUND',
	'EAI_AGAIN',
	'UND_ERR_CONNECT_TIMEOUT',
	'UND_ERR_SOCKET',
])

// Retry transient Telegram/network failures a few times. A 5xx is usually a
// gateway hiccup, not a rejected message; payload ops get the full budget,
// low-value ops one extra attempt.
function isTransientTgError(e: unknown): boolean {
	try {
		const err = e as {
			error_code?: unknown
			code?: unknown
			cause?: { code?: unknown }
		}
		const status = Number(err?.error_code)
		if (Number.isFinite(status) && status >= 500 && status <= 599) return true
		const code = String(err?.code ?? err?.cause?.code ?? '')
		return TRANSIENT_CODES.has(code)
	} catch {
		return false
	}
}

// True when an enqueue rejection is an intentional load-shed (deep queue,
// too many waiters, parked too long) rather than a real send failure.
// Callers for droppable ops should swallow these silently.
export function isQueueDrop(e: unknown): boolean {
	try {
		const msg = typeof e === 'string' ? e : String((e as { message?: unknown })?.message ?? e)
		return msg.includes('dropping op=') || msg.includes('queue deep') ||
			msg.includes('parked too long')
	} catch {
		return false
	}
}

interface QueueItem {
	fn: () => Promise<unknown>
	resolve: (v: unknown) => void
	reject: (e: unknown) => void
	attempts: number
	label: string
	priority: boolean
}

// Backpressure cap: enqueue waits for space instead of rejecting, so info
// is slowed down but never dropped. 500 slots x Telegram spacing bounds
// memory while a flood drains. Waiters (producers parked on a full queue)
// are bounded separately: beyond MAX_WAITERS even important ops drop rather
// than accumulating unbounded setTimeout loops and promise closures.
const MAX_QUEUE = 500
const MAX_WAITERS = 1000
// When the queue is this deep, low-value ops (notices, service lines,
// prompts) drop immediately instead of adding hours of backlog. Messages,
// media and voices always wait - they are the relay payload.
const DROP_WHEN_DEEP = 400
const DROPPABLE_LABELS = new Set([
	'notice',
	'service-line',
	'prompt',
	'edit-topic',
	'new-topic',
	'cleanup',
])
// Low-value ops give up after N flood retries; payload ops retry unbounded.
const FLOOD_MAX_RETRIES_LOW = 3
// Transient 5xx/network failures are different from flood waits: retry a
// couple of times with backoff, then let the caller triage.
const TRANSIENT_MAX_RETRIES = 3
// A parked producer waits at most this long for space before it drops
// (low-value) or rejects (payload) instead of waiting forever.
const MAX_PARK_MS = 60_000

export class RateLimiter {
	private baseLimitMs: number
	private limitMs: number
	private maxWaitMs: number
	private defaultRetryAfterMs: number
	private retryBufferMs: number
	private queue: QueueItem[] = []
	private running = false
	private lastRun = 0
	private blockedUntil = 0
	private waiters = 0
	private dropped = 0
	private floodRetries = 0
	private successStreak = 0
	private lastFullLog = 0

	constructor(limitMs: number = 3000, opts: RateLimiterOptions = {}) {
		this.baseLimitMs = limitMs
		this.limitMs = limitMs
		// NB: opts.maxRetries is accepted for compat but payload 429 retries
		// are unbounded by design (slow delivery, never drop).
		void opts.maxRetries
		this.maxWaitMs = opts.maxWaitMs ?? 120_000
		this.defaultRetryAfterMs = opts.defaultRetryAfterMs ?? 5_000
		this.retryBufferMs = opts.retryBufferMs ?? 500
	}

	enqueue<T>(fn: () => Promise<T>, label = 'send', priority = false): Promise<T> {
		// Deep backlog: shed low-value load immediately so user messages
		// keep flowing. 500 x 3s is already ~25min of delay.
		if (this.queue.length >= DROP_WHEN_DEEP && DROPPABLE_LABELS.has(label)) {
			this.dropped++
			return Promise.reject(
				new Error(`[BRIDGE] queue deep (${this.queue.length}), dropping op=${label}`),
			)
		}
		if (this.waiters >= MAX_WAITERS && DROPPABLE_LABELS.has(label)) {
			this.dropped++
			return Promise.reject(
				new Error(`[BRIDGE] too many waiters (${this.waiters}), dropping op=${label}`),
			)
		}
		return new Promise<T>((resolve, reject) => {
			const item = {
				fn: fn as () => Promise<unknown>,
				resolve: resolve as (v: unknown) => void,
				reject,
				attempts: 0,
				label,
				priority,
			}
			if (priority) {
				// DM fast lane: jump ahead of queued group traffic (FIFO
				// among priority items) so 1:1 messages always go first.
				// Still respect the cap - otherwise a DM burst could grow
				// the queue without bound while group traffic parks.
				if (this.queue.length < MAX_QUEUE) {
					let idx = this.queue.findIndex((q) => !q.priority)
					if (idx === -1) idx = this.queue.length
					this.queue.splice(idx, 0, item)
					void this.drain()
					return
				}
			}
			if (this.queue.length >= MAX_QUEUE) {
				// Full: slow the producer instead of dropping. Poll for space;
				// drain() frees slots as floods clear. Parked time is capped
				// so a stuck flood cannot accumulate unbounded waiters.
				if (this.waiters >= MAX_WAITERS) {
					this.dropped++
					this.warnFull(
						`[BRIDGE] queue full (${this.queue.length}) waiters=${this.waiters}, dropping op=${label}`,
					)
					reject(new Error(`[BRIDGE] queue full, dropping op=${label}`))
					return
				}
				this.waiters++
				const parkedAt = Date.now()
				this.warnFull(
					`[BRIDGE] queue full (${this.queue.length}), slowing op=${label} instead of dropping`,
				)
				const waitForSpace = (): void => {
					if (this.queue.length < MAX_QUEUE) {
						this.waiters = Math.max(0, this.waiters - 1)
						if (item.priority) {
							let idx = this.queue.findIndex((q) => !q.priority)
							if (idx === -1) idx = this.queue.length
							this.queue.splice(idx, 0, item)
						} else {
							this.queue.push(item)
						}
						void this.drain()
					} else if (Date.now() - parkedAt > MAX_PARK_MS) {
						this.waiters = Math.max(0, this.waiters - 1)
						this.dropped++
						console.warn(
							`[BRIDGE] parked op=${label} waited >${MAX_PARK_MS / 1000}s, dropping`,
						)
						reject(new Error(`[BRIDGE] parked too long, dropping op=${label}`))
					} else {
						setTimeout(waitForSpace, 1000)
					}
				}
				waitForSpace()
				return
			}
			this.queue.push(item)
			void this.drain()
		})
	}

	/** Number of items waiting (including the in-flight one). */
	get depth(): number {
		return this.queue.length
	}

	/** Parked producers waiting for queue space. */
	get parked(): number {
		return this.waiters
	}

	/** Total pressure: queued + parked. */
	get pressure(): number {
		return this.queue.length + this.waiters
	}

	/** Counters for HEALTH lines. */
	stats(): {
		depth: number
		parked: number
		dropped: number
		floodRetries: number
		spacing: number
	} {
		return {
			depth: this.queue.length,
			parked: this.waiters,
			dropped: this.dropped,
			floodRetries: this.floodRetries,
			spacing: this.limitMs,
		}
	}

	/** Current per-call spacing (ms). */
	get spacing(): number {
		return this.limitMs
	}

	/** Change the per-call spacing (used to widen spacing during post-reconnect catch-up). */
	setSpacing(ms: number): void {
		this.limitMs = ms
		this.baseLimitMs = ms
	}

	// Full-queue logs can fire hundreds of times during a burst; keep one
	// per second so stderr does not become its own bottleneck.
	private warnFull(msg: string): void {
		const now = Date.now()
		if (now - this.lastFullLog < 1_000) return
		this.lastFullLog = now
		console.warn(msg)
	}

	// Adaptive pacing: after a clean streak, ease back toward base so a
	// past flood does not keep the relay slow forever.
	private noteSuccess(): void {
		this.successStreak++
		if (this.successStreak >= 50 && this.limitMs > this.baseLimitMs) {
			this.successStreak = 0
			this.limitMs = Math.max(this.baseLimitMs, this.limitMs - 100)
		}
	}

	private noteFlood(): void {
		// Widen spacing slightly on each flood so the next burst starts
		// slower instead of 429ing in lockstep again (capped at 5s).
		this.successStreak = 0
		this.floodRetries++
		if (this.limitMs < 5_000) this.limitMs = Math.min(5_000, this.limitMs + 500)
	}

	private async drain(): Promise<void> {
		if (this.running) return
		this.running = true
		try {
			while (this.queue.length > 0) {
				const now = Date.now()
				const wait = Math.max(
					this.limitMs - (now - this.lastRun),
					this.blockedUntil - now,
				)
				if (wait > 0) await new Promise((r) => setTimeout(r, wait))
				const item = this.queue.shift()!
				try {
					item.resolve(await item.fn())
					this.lastRun = Date.now()
					this.noteSuccess()
				} catch (e) {
					const retryAfter = getRetryAfterSeconds(e)
					if (retryAfter !== null) {
						// Flood: low-value ops give up after N retries so one
						// noisy topic cannot stall payload forever; payload
						// requeues at FRONT to preserve global FIFO order.
						item.attempts += 1
						if (
							DROPPABLE_LABELS.has(item.label) &&
							item.attempts > FLOOD_MAX_RETRIES_LOW
						) {
							this.dropped++
							this.lastRun = Date.now()
							item.reject(e)
							continue
						}
						const baseMs = retryAfter > 0 ? retryAfter * 1000 : this.defaultRetryAfterMs
						const waitMs = Math.min(baseMs + this.retryBufferMs, this.maxWaitMs)
						this.blockedUntil = Date.now() + waitMs
						this.noteFlood()
						this.queue.unshift(item)
						console.warn(
							`[BRIDGE] Telegram flood control: retry after ${
								(waitMs / 1000).toFixed(1)
							}s ` +
								`(attempt ${item.attempts}, op=${item.label}, ` +
								`queue=${this.queue.length})`,
						)
					} else if (isTransientTgError(e)) {
						const max = DROPPABLE_LABELS.has(item.label) ? 1 : TRANSIENT_MAX_RETRIES
						if (item.attempts >= max) {
							this.lastRun = Date.now()
							item.reject(e)
							continue
						}
						item.attempts += 1
						const waitMs = Math.min(1_000 * 2 ** (item.attempts - 1), 15_000)
						this.blockedUntil = Date.now() + waitMs
						this.queue.unshift(item)
						console.warn(
							`[BRIDGE] Telegram transient failure: retry in ${
								(waitMs / 1000).toFixed(1)
							}s (attempt ${item.attempts}, op=${item.label})`,
						)
					} else {
						// Callers keep their own triage (edits, deletes and
						// reactions already log at the right level).
						// REACTION_INVALID and target-gone 400s are expected
						// too - the caller swallows them, so the queue must
						// stay quiet instead of dumping the full stack. A
						// 429 retry is logged above; everything else is the
						// caller's job.
						this.lastRun = Date.now()
						item.reject(e)
					}
				}
			}
		} finally {
			this.running = false
		}
	}
}
