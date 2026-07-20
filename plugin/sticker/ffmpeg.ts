/**
 * FFmpeg command builder and executor for animated (video/GIF) stickers.
 *
 * This module is designed to run INSIDE a worker thread — all I/O is
 * synchronous so it blocks only the worker, never the main event loop.
 *
 * Key features:
 *   • Single-pass multi-format via the `split` filter
 *   • Adaptive quality: retries at lower quality/fps until output ≤ maxSize
 *   • Temp files are namespaced per job to prevent collisions between workers
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, unlinkSync } from 'node:fs'
import type { StickerFormat } from './types.ts'

const SIZE = 512
const MAX_DURATION = 11
const TIMEOUT_MS = 60_000

/**
 * Compression levels tried in order.
 * Each step reduces quality and framerate to shrink the output.
 */
const LEVELS = [
	{ quality: 60, fps: 15 },
	{ quality: 40, fps: 12 },
	{ quality: 25, fps: 10 },
	{ quality: 15, fps: 8 },
] as const

export interface FfmpegResult {
	format: StickerFormat
	buffer: Buffer
	size: number
}

// ── public API ──────────────────────────────────────────────────────

/**
 * Encode a video into animated WebP stickers with adaptive quality.
 *
 * Tries progressively lower quality levels until every output fits
 * under `maxSize` bytes. Returns one result per requested format.
 */
export function encodeVideo(
	inputPath: string,
	outputDir: string,
	prefix: string,
	formats: StickerFormat[],
	maxSize: number,
): FfmpegResult[] {
	for (const level of LEVELS) {
		const results = runFfmpeg(inputPath, outputDir, prefix, formats, level)
		if (results.every(r => r.size <= maxSize)) return results

		// too big — clean outputs and retry with lower settings
		cleanOutputs(outputDir, prefix, formats)
	}

	// fallback: return whatever the lowest level produced
	return runFfmpeg(inputPath, outputDir, prefix, formats, LEVELS[LEVELS.length - 1])
}

/** Remove all temp files created by a sticker job. */
export function cleanup(
	inputPath: string,
	outputDir: string,
	prefix: string,
	formats: StickerFormat[],
): void {
	try { unlinkSync(inputPath) } catch { /* already gone */ }
	cleanOutputs(outputDir, prefix, formats)
}

// ── internals ───────────────────────────────────────────────────────

/** Execute a single ffmpeg pass producing all requested formats. */
function runFfmpeg(
	inputPath: string,
	outputDir: string,
	prefix: string,
	formats: StickerFormat[],
	level: { quality: number; fps: number },
): FfmpegResult[] {
	const { filter, maps } = buildFilterGraph(
		formats, level.quality, level.fps, outputDir, prefix,
	)

	const args = [
		'-y',                       // overwrite
		'-t', String(MAX_DURATION), // cap input duration
		'-i', inputPath,
		'-filter_complex', filter,
		...maps,
	]

	const proc = spawnSync('ffmpeg', args, {
		timeout: TIMEOUT_MS,
		stdio: ['pipe', 'pipe', 'pipe'],
	})

	if (proc.status !== 0) {
		const stderr = proc.stderr?.toString().slice(-500) || 'unknown error'
		throw new Error(`ffmpeg exited ${proc.status}: ${stderr}`)
	}

	return readOutputs(outputDir, prefix, formats)
}

/**
 * Build the ffmpeg -filter_complex string and per-output -map args.
 *
 * When multiple formats are requested, the input is decoded once and
 * `split` fans it into parallel scale pipelines — one decode, N outputs.
 */
function buildFilterGraph(
	formats: StickerFormat[],
	quality: number,
	fps: number,
	outputDir: string,
	prefix: string,
): { filter: string; maps: string[] } {
	const filters: string[] = []
	const maps: string[] = []

	const codecArgs = (q: number) => [
		'-c:v', 'libwebp',
		'-loop', '0',
		'-an',
		'-quality', String(q),
		'-compression_level', '4',
		'-preset', 'icon',
	]

	if (formats.length === 1) {
		const f = formats[0]
		filters.push(`[0:v]fps=${fps},${scaleFilter(f)}[${f}]`)
		maps.push(
			'-map', `[${f}]`,
			...codecArgs(quality),
			outPath(outputDir, prefix, f),
		)
	} else {
		// split → parallel pipelines (one decode pass, N outputs)
		const labels = formats.map((_, i) => `[s${i}]`).join('')
		filters.push(`[0:v]fps=${fps},split=${formats.length}${labels}`)

		for (let i = 0; i < formats.length; i++) {
			const f = formats[i]
			filters.push(`[s${i}]${scaleFilter(f)}[${f}]`)
			maps.push(
				'-map', `[${f}]`,
				...codecArgs(quality),
				outPath(outputDir, prefix, f),
			)
		}
	}

	return { filter: filters.join(';'), maps }
}

/** Get the ffmpeg scale/pad/crop filter chain for a sticker format. */
function scaleFilter(format: StickerFormat): string {
	if (format === 'full') {
		// contain: fit inside 512×512, pad with transparency
		return [
			`scale=${SIZE}:${SIZE}:force_original_aspect_ratio=decrease`,
			'format=yuva420p',
			`pad=${SIZE}:${SIZE}:(ow-iw)/2:(oh-ih)/2:color=0x00000000`,
		].join(',')
	}

	// crop, circle, rounded → cover: fill 512×512, center-crop overflow
	return [
		`scale=${SIZE}:${SIZE}:force_original_aspect_ratio=increase`,
		`crop=${SIZE}:${SIZE}`,
	].join(',')
}

// ── file helpers ────────────────────────────────────────────────────

function outPath(dir: string, prefix: string, format: StickerFormat): string {
	return `${dir}/${prefix}_${format}.webp`
}

function readOutputs(
	dir: string,
	prefix: string,
	formats: StickerFormat[],
): FfmpegResult[] {
	return formats.map(f => {
		const buf = readFileSync(outPath(dir, prefix, f))
		return { format: f, buffer: buf, size: buf.length }
	})
}

function cleanOutputs(dir: string, prefix: string, formats: StickerFormat[]): void {
	for (const f of formats) {
		try { unlinkSync(outPath(dir, prefix, f)) } catch { /* already gone */ }
	}
}
