export class RateLimiter {
	private limitMs: number
	private queues: Map<number, Array<() => Promise<void>>> = new Map()
	private timers: Map<number, ReturnType<typeof setTimeout>> = new Map()

	constructor(limitMs: number = 1000) {
		this.limitMs = limitMs
	}

	enqueue(fn: () => Promise<void>, topicId?: number): void {
		const key = topicId || 0
		if (!this.queues.has(key)) {
			this.queues.set(key, [])
		}
		this.queues.get(key)!.push(fn)
		this.processQueue(key)
	}

	private processQueue(topicId: number): void {
		if (this.timers.has(topicId)) return

		const queue = this.queues.get(topicId)
		if (!queue || queue.length === 0) return

		const timer = setTimeout(async () => {
			const fn = queue.shift()
			if (fn) {
				await fn().catch((e) => console.error('RateLimiter error:', e))
				if (queue.length > 0) {
					this.processQueue(topicId)
				} else {
					this.timers.delete(topicId)
					this.queues.delete(topicId)
				}
			} else {
				this.timers.delete(topicId)
				this.queues.delete(topicId)
			}
		}, this.limitMs)

		this.timers.set(topicId, timer)
	}

	async flush(topicId?: number): Promise<void> {
		const key = topicId || 0
		while (this.queues.get(key)?.length) {
			await new Promise((r) => setTimeout(r, this.limitMs))
			const fn = this.queues.get(key)?.shift()
			if (fn) await fn().catch(() => {})
		}
		this.timers.delete(key)
		this.queues.delete(key)
	}
}
