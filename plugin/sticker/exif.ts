/**
 * EXIF metadata builder and injector for WhatsApp stickers.
 *
 * WhatsApp reads sticker pack info (name, author) from a custom EXIF tag
 * embedded inside the WebP file. This module builds the raw TIFF/EXIF blob
 * and injects it via node-webpmux (works for both static and animated WebP).
 */
import webpmux from 'node-webpmux'
const { Image } = webpmux
import type { StickerMetadata } from './types.ts'

/**
 * Build the binary EXIF blob that WhatsApp reads for sticker metadata.
 *
 * TIFF layout (little-endian):
 *   [0..1]   "II"          — byte order mark
 *   [2..3]   0x002A        — TIFF magic number
 *   [4..7]   0x00000008    — offset to IFD0 (from byte 0)
 *   [8..9]   0x0001        — IFD0 entry count
 *   [10..21] IFD entry     — tag 0x0041, type UNDEFINED, → JSON
 *   [22..25] 0x00000000    — next IFD offset (none)
 *   [26..]   JSON payload  — sticker metadata
 */
function buildExifBlob(metadata: StickerMetadata): Buffer {
	const json = Buffer.from(
		JSON.stringify({
			'sticker-pack-id': 'com.ergon.bot',
			'sticker-pack-name': metadata.pack,
			'sticker-pack-publisher': metadata.author,
			'emojis': [],
		}),
		'utf-8'
	)

	const header = Buffer.from([
		0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00, 0x00,
		0x00, 0x16, 0x00, 0x00, 0x00
	])
	
	header.writeUInt32LE(json.length, 14)

	return Buffer.concat([header, json])
}

/**
 * Inject sticker pack metadata into a WebP buffer.
 * Returns a new buffer with the EXIF chunk embedded.
 */
export async function injectExif(
	webp: Buffer,
	metadata: StickerMetadata,
): Promise<Buffer> {
	const img = new Image()
	await img.load(webp)
	img.exif = buildExifBlob(metadata)
	return (await img.save(null)) as Buffer
}
