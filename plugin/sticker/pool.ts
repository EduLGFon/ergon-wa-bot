/**
 * Fixed-size worker thread pool for video sticker processing.
 *
 * Manages N workers, each capable of running one ffmpeg job at a time.
 * When all workers are busy, incoming jobs are queued (FIFO).
 * Crashed workers are automatically respawned.
 */
import { Worker } from 'node:worker_threads'
import type {
	StickerFormat,
	StickerResult,
	WorkerRequest,
	WorkerResponse,
} from './types.ts'

// ── types ───────────────────────────────────────────────────────────

interface PendingJob {
	resolve: (results: StickerResult[]) => void
	reject: (error: Error) => void
}

interface PoolWorker {
	instance: Worker
	busy: boolean
	pending?: PendingJob
}

interface QueueEntry {
	buffer: Buffer
	formats: StickerFormat[]
	maxSize: number
	resolve: PendingJob['resolve']
	reject: PendingJob['reject']
}

// ── pool ────────────────────────────────────────────────────────────

export class StickerPool {
	private workers: PoolWorker[]
	private queue: QueueEntry[] = []
	private nextId = 0

	constructor(size = 2) {
		this.workers = Array.from({ length: size }, () => this.spawn())
	}

	/**
	 * Submit a video sticker job.
	 * Resolves when the assigned worker finishes processing.
	 */
	process(job: {
		buffer: Buffer
		formats: StickerFormat[]
		maxSize: number
	}): Promise<StickerResult[]> {
		return new Promise((resolve, reject) => {
			const idle = this.workers.find(w => !w.busy)

			if (idle) {
				this.dispatch(idle, job, resolve, reject)
			} else {
				this.queue.push({ ...job, resolve, reject })
			}
		})
	}

	/** Terminate every worker. Call on process shutdown. */
	async terminate(): Promise<void> {
		await Promise.all(this.workers.map(w => w.instance.terminate()))
	}

	// ── internals ───────────────────────────────────────────────────

	private spawn(): PoolWorker {
		const instance = new Worker(
			new URL('./worker.ts', import.meta.url),
		)
		const pw: PoolWorker = { instance, busy: false }

		instance.on('message', (res: WorkerResponse) => {
			const { pending } = pw
			pw.busy = false
			pw.pending = undefined
			if (!pending) return

			if (res.error) {
				pending.reject(new Error(res.error))
			} else {
				pending.resolve(
					(res.results ?? []).map(r => ({
						format: r.format,
						buffer: Buffer.from(r.buffer),
					})),
				)
			}

			this.drain()
		})

		instance.on('error', (err: any) => {
			print('STICKER/POOL', `Worker crashed: ${err.message}`, 'red')

			// reject in-flight job
			pw.pending?.reject(err)
			pw.busy = false
			pw.pending = undefined

			// replace the dead worker
			const idx = this.workers.indexOf(pw)
			if (idx !== -1) this.workers[idx] = this.spawn()

			this.drain()
		})

		return pw
	}

	private dispatch(
		pw: PoolWorker,
		job: { buffer: Buffer; formats: StickerFormat[]; maxSize: number },
		resolve: PendingJob['resolve'],
		reject: PendingJob['reject'],
	): void {
		pw.busy = true
		pw.pending = { resolve, reject }

		const req: WorkerRequest = {
			id: this.nextId++,
			buffer: job.buffer,
			formats: job.formats,
			maxSize: job.maxSize,
		}

		pw.instance.postMessage(req)
	}

	/** Send queued jobs to any idle workers. */
	private drain(): void {
		while (this.queue.length > 0) {
			const idle = this.workers.find(w => !w.busy)
			if (!idle) return

			const { resolve, reject, ...job } = this.queue.shift()!
			this.dispatch(idle, job, resolve, reject)
		}
	}
}
