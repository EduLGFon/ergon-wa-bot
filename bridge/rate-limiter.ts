// Outgoing queue for Telegram Bot API calls.
//
// Telegram throttles per-chat (roughly 1 msg/s, ~20 msg/min per group) and
// all forum topics share the same underlying supergroup chat, so ALL
// tg.api.* calls go through ONE global FIFO queue with `limitMs` spacing
// between individual API calls (not per logical message - one logical send
// can be 2-3 API calls: header + sticker, content + follow-up, …).
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
		}
		if (anyErr && anyErr.error_code === 429) {
			const ra = anyErr.parameters?.retry_after
			if (typeof ra === 'number' && Number.isFinite(ra) && ra >= 0) return ra
			// Fallback: parse "retry after N" out of the description.
			const desc = typeof anyErr.description === 'string' ? anyErr.description : ''
			const m = /retry after (\d+)/i.exec(desc)
			if (m) return Number(m[1])
			return 0 // 429 without a usable value - caller applies default wait.
		}
	} catch {
		// fall through to null
	}
	return null
}

interface QueueItem {
	fn: () => Promise<unknown>
	resolve: (v: unknown) => void
	reject: (e: unknown) => void
	attempts: number
	label: string
}

// Backpressure cap: enqueue waits for space instead of rejecting, so info
// is slowed down but never dropped. 500 slots × Telegram spacing bounds
// memory while a flood drains.
const MAX_QUEUE = 500

export class RateLimiter {
	private limitMs: number
	private maxWaitMs: number
	private defaultRetryAfterMs: number
	private retryBufferMs: number
	private queue: QueueItem[] = []
	private running = false
	private lastRun = 0
	private blockedUntil = 0

	constructor(limitMs: number = 3000, opts: RateLimiterOptions = {}) {
		this.limitMs = limitMs
		// NB: opts.maxRetries is accepted for compat but 429 retries are
		// unbounded by design (slow delivery, never drop).
		void opts.maxRetries
		this.maxWaitMs = opts.maxWaitMs ?? 120_000
		this.defaultRetryAfterMs = opts.defaultRetryAfterMs ?? 5_000
		this.retryBufferMs = opts.retryBufferMs ?? 500
	}

	enqueue<T>(fn: () => Promise<T>, label = 'send'): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			const item = {
				fn: fn as () => Promise<unknown>,
				resolve: resolve as (v: unknown) => void,
				reject,
				attempts: 0,
				label,
			}
			if (this.queue.length >= MAX_QUEUE) {
				// Full: slow the producer instead of dropping. Poll for space;
				// drain() frees slots as floods clear.
				console.warn(
					`[BRIDGE] queue full (${this.queue.length}), slowing op=${label} instead of dropping`,
				)
				const waitForSpace = (): void => {
					if (this.queue.length < MAX_QUEUE) {
						this.queue.push(item)
						void this.drain()
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
				} catch (e) {
					const retryAfter = getRetryAfterSeconds(e)
					if (retryAfter !== null) {
						// Never drop on flood: requeue at the FRONT to preserve
						// global FIFO order and slow the whole queue down.
						item.attempts += 1
						const baseMs = retryAfter > 0 ? retryAfter * 1000 : this.defaultRetryAfterMs
						const waitMs = Math.min(baseMs + this.retryBufferMs, this.maxWaitMs)
						this.blockedUntil = Date.now() + waitMs
						this.queue.unshift(item)
						console.warn(
							`[BRIDGE] Telegram flood control: retry after ${
								(waitMs / 1000).toFixed(1)
							}s ` +
								`(attempt ${item.attempts}, op=${item.label}, ` +
								`queue=${this.queue.length})`,
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
