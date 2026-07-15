/**
 * Image-to-sticker conversion using sharp.
 *
 * Handles all 4 static sticker formats (full, crop, circle, rounded)
 * entirely on the main thread — sharp is fast enough that no worker
 * offloading is needed for single images.
 */
import sharp from 'sharp'
import type { StickerFormat } from './types.ts'

const SIZE = 512

/**
 * Convert an image buffer into a 512×512 WebP sticker.
 *
 * @param buffer   Raw image bytes (JPEG, PNG, WebP, etc.)
 * @param format   Resize/crop strategy
 * @param quality  WebP quality (1–100, default 80)
 */
export async function processImage(
	buffer: Buffer,
	format: StickerFormat,
	quality = 80,
): Promise<Buffer> {
	const fit = format === 'full' ? 'contain' : ('cover' as const)

	let pipeline = sharp(buffer)
		.resize(SIZE, SIZE, {
			fit,
			background: { r: 0, g: 0, b: 0, alpha: 0 },
		})
		.ensureAlpha()

	// Apply shape mask for circle / rounded formats
	const mask = buildMask(format)
	if (mask) {
		pipeline = pipeline.composite([{ input: mask, blend: 'dest-in' }])
	}

	return pipeline.webp({ quality }).toBuffer()
}

// ── mask helpers ─────────────────────────────────────────────────────

/** Create an SVG mask for circle or rounded-rect. Returns null for full/crop. */
function buildMask(format: StickerFormat): Buffer | null {
	switch (format) {
		case 'circle': {
			const r = SIZE / 2
			return svgToBuffer(
				`<circle cx="${r}" cy="${r}" r="${r}" fill="white"/>`,
			)
		}
		case 'rounded': {
			const rx = Math.round(SIZE / 10)
			return svgToBuffer(
				`<rect x="0" y="0" width="${SIZE}" height="${SIZE}" rx="${rx}" ry="${rx}" fill="white"/>`,
			)
		}
		default:
			return null
	}
}

function svgToBuffer(shape: string): Buffer {
	return Buffer.from(
		`<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">${shape}</svg>`,
	)
}
