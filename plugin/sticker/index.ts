/**
 * Sticker engine — public facade.
 *
 * Single entry point for sticker creation:
 *   • Images  → sharp on the main thread (fast, ~50ms)
 *   • Videos  → worker thread pool running ffmpeg (non-blocking)
 *   • All outputs get EXIF metadata injected before being returned
 */
import type { StickerOptions, StickerResult } from './types.ts'
import { processImage } from './image.ts'
import { injectExif } from './exif.ts'
import { StickerPool } from './pool.ts'

const DEFAULT_MAX_SIZE = 1_000_000 // 1 MB — WhatsApp won't load larger stickers
const POOL_SIZE = 2

const pool = new StickerPool(POOL_SIZE)

/**
 * Create one or more stickers from a media buffer.
 *
 * @example
 * const stickers = await createStickers({
 *   buffer: imageBuffer,
 *   isVideo: false,
 *   formats: ['full', 'crop'],
 *   metadata: { pack: 'My Pack', author: 'Bot' },
 * })
 * for (const s of stickers) await send({ sticker: s.buffer })
 */
export async function createStickers(opts: StickerOptions): Promise<StickerResult[]> {
	const {
		buffer,
		isVideo,
		formats,
		metadata,
		quality = 80,
		maxSize = DEFAULT_MAX_SIZE,
	} = opts

	let results: StickerResult[]

	if (isVideo) {
		// Video formats: only full/crop supported in ffmpeg pipeline
		// circle/rounded silently fall back to crop (no mask overlay in ffmpeg)
		const videoFormats = formats.map(f =>
			f === 'circle' || f === 'rounded' ? 'crop' as const : f,
		)
		// deduplicate (e.g. if user asked for crop + circle → two crops)
		const unique = [...new Set(videoFormats)]

		results = await pool.process({ buffer, formats: unique, maxSize })
	} else {
		// Images: process all formats in parallel on the main thread
		results = await Promise.all(
			formats.map(async format => ({
				format,
				buffer: await processImage(buffer, format, quality),
			})),
		)
	}

	// Inject EXIF metadata (pack name, author) into every sticker
	return Promise.all(
		results.map(async r => ({
			format: r.format,
			buffer: await injectExif(r.buffer, metadata),
		})),
	)
}

export type { StickerFormat, StickerMetadata, StickerResult } from './types.ts'
