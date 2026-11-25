// viewOnce tests - quoted view-once resolution through a cached original
import { downloadMedia, getMsgType } from '@util/msgTools.ts'
import { getMedia } from '@util/msgAbstractions.ts'
import cache from '@plugin/cache.ts'
import { ok, strictEqual } from 'node:assert/strict'
import proto from '@util/proto.ts'

proto()

const chat = '5511999999999@s.whatsapp.net'
const originalUrl = 'https://example.invalid/view-once.mp4'
const originalKey = new Uint8Array([1, 2, 3])
const originalBytes = new Uint8Array([9, 8, 7])

// Cached original as getCtx would store it: keys in media, content in message.
const original: any = {
	chat,
	author: 1,
	type: 'video',
	text: '',
	mime: 'video/mp4',
	media: {
		url: originalUrl,
		directPath: '/vo',
		mediaKey: originalKey,
		thumbnailDirectPath: '',
		mime: 'video/mp4',
		length: originalBytes.length,
		duration: 1,
		height: 2,
		width: 2,
		type: 'video',
	},
	message: {
		videoMessage: {
			url: originalUrl,
			directPath: '/vo',
			mediaKey: originalKey,
			mimetype: 'video/mp4',
			fileLength: originalBytes.length,
			seconds: 1,
			height: 2,
			width: 2,
		},
	},
	key: { id: 'VO-ORIG', remoteJid: chat, fromMe: false },
}

const user: any = { id: 1, lid: chat, phone: '5511999999999', msgs: new Map() }
user.msgs.set('VO-ORIG', original)
cache.users.set(user.id, user)
cache.userByLid.set(chat, user)
cache.media.set(originalUrl, {
	buffer: originalBytes,
	url: originalUrl,
	mime: 'video/mp4',
	length: originalBytes.length,
	duration: 1,
	type: 'video',
	height: 2,
	width: 2,
})

// Quote as getQuoted now builds it for post-Nov-2026 view-once: inner media
// node present, mediaKey withheld, mediaUnavailable flag set.
function viewOnceQuote(id: string): any {
	return {
		type: 'video',
		text: '',
		mime: 'video/mp4',
		mediaUnavailable: 'view-once',
		message: { videoMessage: { url: 'https://example.invalid/empty.mp4' } },
		key: { id, remoteJid: chat, fromMe: false },
	}
}

function replyTo(quoted: any): any {
	return {
		chat,
		type: 'text',
		text: '.reveal',
		quoted,
		key: { id: 'REPLY', remoteJid: chat, fromMe: false },
	}
}

Deno.test('viewOnce: empty quote key resolves the cached original bytes', async () => {
	const media = await getMedia(replyTo(viewOnceQuote('VO-ORIG')))
	ok(media)
	strictEqual(media.type, 'video')
	strictEqual(media.buffer.length, originalBytes.length)
	strictEqual(media.target.type, 'video')
})

Deno.test('viewOnce: nothing recoverable returns undefined without throwing', async () => {
	const media = await getMedia(replyTo(viewOnceQuote('VO-MISSING')))
	strictEqual(media, undefined)
})

Deno.test('viewOnce: downloadMedia refuses an empty media key', async () => {
	const raw: any = {
		message: {
			viewOnceMessageV2: {
				message: {
					imageMessage: {
						url: 'https://example.invalid/empty.png',
						mediaKey: new Uint8Array(),
					},
				},
			},
		},
	}
	const types = getMsgType(raw.message)
	strictEqual(types[0], 'image')
	strictEqual(await downloadMedia(raw, types, true, true), undefined)
})
