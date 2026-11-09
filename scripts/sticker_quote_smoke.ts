// sticker_quote_smoke - synthetic check for quoted-media sticker creation.
//
// Verifies that getMedia resolves cached bytes for a quoted image and a
// quoted video message, and that those bytes route through createStickers.
// No network, no personal data: media buffers are synthetic and cache.media is
// pre-populated so no Baileys download is attempted.
//
//   deno run -A scripts/sticker_quote_smoke.ts
import { createStickers, shutdownStickers } from '@plugin/sticker/index.ts'
import { getMedia } from '@util/msgAbstractions.ts'
import { getMsgType } from '@util/msgTools.ts'
import cache from '@plugin/cache.ts'
import proto from '@util/proto.ts'
import { Buffer } from 'node:buffer'
import sharp from 'sharp'

proto()
let failures = 0
function check(name: string, cond: boolean): void {
	if (!cond) {
		failures++
		console.error(`FAIL: ${name}`)
	} else console.log(`ok: ${name}`)
}

// Synthetic quoted image message (keys only, like getQuoted stores).
const imageMsg: any = {
	type: 'image',
	media: {
		url: 'https://example.invalid/q.png',
		directPath: '/x',
		mediaKey: new Uint8Array([1, 2, 3]),
	},
	text: '',
	mime: 'image/png',
	message: {
		imageMessage: { url: 'https://example.invalid/q.png', mediaKey: new Uint8Array([1, 2, 3]) },
	},
	key: { id: 'QIMG', remoteJid: '1@s.whatsapp.net', fromMe: false },
}

// Synthetic quoted video message (keys only).
const videoMsg: any = {
	type: 'video',
	media: {
		url: 'https://example.invalid/q.mp4',
		directPath: '/y',
		mediaKey: new Uint8Array([4, 5, 6]),
	},
	text: '',
	mime: 'video/mp4',
	message: {
		videoMessage: { url: 'https://example.invalid/q.mp4', mediaKey: new Uint8Array([4, 5, 6]) },
	},
	key: { id: 'QVID', remoteJid: '1@s.whatsapp.net', fromMe: false },
}

// Raw-key derivation exercised even though fixtures are cache-hit.
check('quoted image raw key is imageMessage', getMsgType(imageMsg.message)[1] === 'imageMessage')
check('quoted video raw key is videoMessage', getMsgType(videoMsg.message)[1] === 'videoMessage')

// Pre-populate cache.media so getMedia takes the cache hit path (no network).
const imageBytes = await sharp({
	create: { width: 8, height: 8, channels: 3, background: { r: 255, g: 0, b: 0 } },
}).png().toBuffer()
cache.media.add(imageMsg.media.url, {
	buffer: imageBytes,
	url: imageMsg.media.url,
	mime: 'image/png',
	length: imageBytes.length,
	duration: 0,
	type: 'image',
	height: 8,
	width: 8,
})

// Generate a tiny mp4 with ffmpeg for the video path.
const tmpDir = await Deno.makeTempDir({ prefix: 'sticker-smoke-' })
const tmpVideo = `${tmpDir}/tiny.mp4`
const proc = new Deno.Command('ffmpeg', {
	args: [
		'-y',
		'-f',
		'lavfi',
		'-i',
		'color=c=blue:s=16x16:d=1',
		'-c:v',
		'libx264',
		'-t',
		'1',
		tmpVideo,
	],
	stdout: 'piped',
	stderr: 'piped',
})
const { code } = await proc.output()
check('ffmpeg produced a video', code === 0)
const videoBytes = code === 0 ? await Deno.readFile(tmpVideo) : new Uint8Array()
if (videoBytes.length) {
	cache.media.add(videoMsg.media.url, {
		buffer: videoBytes,
		url: videoMsg.media.url,
		mime: 'video/mp4',
		length: videoBytes.length,
		duration: 1,
		type: 'video',
		height: 16,
		width: 16,
	})
}

// Quoted wrappers (no direct media on the outer message).
const outerImage: any = { quoted: imageMsg }
const outerVideo: any = { quoted: videoMsg }

const imgResult = await getMedia(outerImage as any)
check('quoted image resolves bytes', !!imgResult && imgResult.buffer?.length > 0)
check('quoted image type is image', imgResult?.type === 'image')

const vidResult = await getMedia(outerVideo as any)
check('quoted video resolves bytes', !!vidResult && vidResult.buffer?.length > 0)
check('quoted video type is video', vidResult?.type === 'video')

// Route resolved image bytes through createStickers.
if (imgResult) {
	const stickers = await createStickers({
		buffer: Buffer.from(imgResult.buffer),
		isVideo: false,
		formats: ['full', 'crop'],
		metadata: { pack: 'Smoke Pack', author: 'Bot' },
	})
	check('image routes to createStickers (2 stickers)', stickers.length === 2)
	check('image stickers have buffers', stickers.every((s) => s.buffer?.length > 0))
}

// Route resolved video bytes through createStickers (if available).
if (vidResult && videoBytes.length) {
	const stickers = await createStickers({
		buffer: Buffer.from(vidResult.buffer),
		isVideo: true,
		formats: ['full', 'crop'],
		metadata: { pack: 'Smoke Pack', author: 'Bot' },
	})
	check('video routes to createStickers (>=1 sticker)', stickers.length >= 1)
	check('video stickers have buffers', stickers.every((s) => s.buffer?.length > 0))
}

// No-media case: getMedia returns undefined.
const noMedia: any = {}
check('no media returns undefined', (await getMedia(noMedia as any)) === undefined)

// Cleanup.
try {
	await Deno.remove(tmpDir, { recursive: true })
} catch {
	// best effort
}

if (failures > 0) {
	console.error(`${failures} check(s) failed`)
	Deno.exit(1)
}
await shutdownStickers()
console.log('all sticker quote smokes passed')
Deno.exit(failures > 0 ? 1 : 0)
