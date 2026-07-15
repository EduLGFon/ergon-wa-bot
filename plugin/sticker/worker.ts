/**
 * Worker thread for video/GIF sticker processing.
 *
 * Receives media buffers from the main thread, writes them to a temp file,
 * runs ffmpeg with adaptive quality, and posts result buffers back.
 * All I/O is intentionally synchronous — this thread exists precisely
 * to keep blocking work off the main event loop.
 */
import { parentPort } from 'node:worker_threads'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { encodeVideo, cleanup } from './ffmpeg.ts'
import type { WorkerRequest, WorkerResponse } from './types.ts'

const TEMP_DIR = 'conf/gen/temp'

// Ensure temp directory exists (no-op if it already does)
try { mkdirSync(TEMP_DIR, { recursive: true }) } catch { /* exists */ }

parentPort!.on('message', (req: WorkerRequest) => {
	const prefix = `stk_${req.id}_${Date.now()}`
	const inputPath = join(TEMP_DIR, `${prefix}_in`)

	try {
		writeFileSync(inputPath, req.buffer)

		const results = encodeVideo(
			inputPath, TEMP_DIR, prefix, req.formats, req.maxSize,
		)

		const response: WorkerResponse = {
			id: req.id,
			results: results.map(r => ({
				format: r.format,
				buffer: r.buffer,
			})),
		}

		parentPort!.postMessage(response)
	} catch (e: any) {
		const response: WorkerResponse = { id: req.id, error: e.message }
		parentPort!.postMessage(response)
	} finally {
		cleanup(inputPath, TEMP_DIR, prefix, req.formats)
	}
})
