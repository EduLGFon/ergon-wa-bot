// Outgoing queue: Telegram allows ~1 msg/sec into the same chat, and all
// forum topics share the same underlying supergroup chat, so we use ONE
// global FIFO queue with `limitMs` spacing between sends (not per-topic).
export class RateLimiter {
	private limitMs: number
	private queue: Array<{ fn: () => Promise<unknown>; resolve: (v: unknown) => void }> = []
	private running = false
	private lastRun = 0

	constructor(limitMs: number = 1000) {
		this.limitMs = limitMs
	}

	enqueue<T>(fn: () => Promise<T>): Promise<T> {
		return new Promise<T>((resolve) => {
			this.queue.push({
				fn: fn as () => Promise<unknown>,
				resolve: resolve as (v: unknown) => void,
			})
			void this.drain()
		})
	}

	private async drain(): Promise<void> {
		if (this.running) return
		this.running = true
		try {
			while (this.queue.length > 0) {
				const wait = this.limitMs - (Date.now() - this.lastRun)
				if (wait > 0) await new Promise((r) => setTimeout(r, wait))
				const item = this.queue.shift()!
				try {
					item.resolve(await item.fn())
				} catch (e) {
					console.error('[BRIDGE] queued send failed:', e)
					item.resolve(undefined)
				}
				this.lastRun = Date.now()
			}
		} finally {
			this.running = false
		}
	}
}
