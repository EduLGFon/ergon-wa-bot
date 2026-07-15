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
			'android-app-store-link': '',
			'ios-app-store-link': '',
		}),
	)

	const HEADER = 26
	const buf = Buffer.alloc(HEADER + json.length)

	// TIFF header
	buf.write('II', 0)                  // little-endian
	buf.writeUInt16LE(0x002a, 2)        // magic
	buf.writeUInt32LE(8, 4)             // IFD0 offset

	// IFD0: 1 entry
	buf.writeUInt16LE(1, 8)

	// IFD entry → sticker JSON
	buf.writeUInt16LE(0x0041, 10)       // tag
	buf.writeUInt16LE(0x0007, 12)       // type: UNDEFINED
	buf.writeUInt32LE(json.length, 14)  // data length
	buf.writeUInt32LE(HEADER, 18)       // offset to data

	// end of IFD chain
	buf.writeUInt32LE(0, 22)

	// payload
	json.copy(buf, HEADER)

	return buf
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
