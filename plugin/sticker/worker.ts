/**
 * Worker thread for video/GIF sticker processing.
 *
 * Receives media buffers from the main thread, writes them to a temp file,
 * runs ffmpeg with adaptive quality, and posts result buffers back.
 * All I/O is intentionally synchronous — this thread exists precisely
 * to keep blocking work off the main event loop.
 */
import { join } from 'jsr:@std/path'
import { cleanup, encodeVideo } from './ffmpeg.ts'
import type { WorkerRequest, WorkerResponse } from './types.ts'

const TEMP_DIR = 'conf/gen/temp'

// Ensure temp directory exists (no-op if it already does)
try {
	Deno.mkdirSync(TEMP_DIR, { recursive: true })
} catch { /* exists */ }

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
	const req = e.data
	const prefix = `stk_${req.id}_${Date.now()}`
	const inputPath = join(TEMP_DIR, `${prefix}_in`)

	try {
		Deno.writeFileSync(inputPath, req.buffer)

		const results = encodeVideo(
			inputPath,
			TEMP_DIR,
			prefix,
			req.formats,
			req.maxSize,
		)

		const response: WorkerResponse = {
			id: req.id,
			results: results.map((r) => ({
				format: r.format,
				buffer: r.buffer,
			})),
		}

		self.postMessage(response)
	} catch (e: any) {
		const response: WorkerResponse = { id: req.id, error: e.message }
		self.postMessage(response)
	} finally {
		cleanup(inputPath, TEMP_DIR, prefix, req.formats)
	}
}
