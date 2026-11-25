// Audio sticker proto patch tests.
// Covers field 134 wrapping, field 26 audio injection and the receive unwrap.
import { buildAudioStickerMessage, installAudioStickerProto } from '@plugin/sticker/audioSticker.ts'
import { ok, strictEqual } from 'node:assert/strict'
import { proto } from 'baileys'
import type { WAMediaUploadFunction } from 'baileys'

installAudioStickerProto()

function readVarint(buf: Uint8Array, start: number): [number, number] {
	let value = 0
	let shift = 0
	let pos = start
	while (pos < buf.length) {
		const byte = buf[pos++]
		value += (byte & 0x7f) * 2 ** shift
		if ((byte & 0x80) === 0) return [value, pos]
		shift += 7
	}
	throw new Error('truncated varint')
}

function readField(buf: Uint8Array, id: number): Uint8Array | null {
	let pos = 0
	while (pos < buf.length) {
		let tag: number
		;[tag, pos] = readVarint(buf, pos)
		const field = Math.floor(tag / 8)
		const wire = tag & 7
		if (wire === 0) {
			pos = readVarint(buf, pos)[1]
		} else if (wire === 1) {
			pos += 8
		} else if (wire === 2) {
			let len: number
			;[len, pos] = readVarint(buf, pos)
			const end = pos + len
			if (end > buf.length) throw new Error('truncated field')
			if (field === id) return buf.subarray(pos, end)
			pos = end
		} else if (wire === 5) {
			pos += 4
		} else {
			throw new Error(`unsupported wire type ${wire}`)
		}
	}
	return null
}

function buildMessage(): Uint8Array {
	const sticker = proto.Message.StickerMessage.create({ url: 'sticker', isAnimated: true })
	;(sticker as any).audioMessage = proto.Message.AudioMessage.create({
		url: 'audio',
		mimetype: 'audio/ogg; codecs=opus',
		seconds: 5,
	})
	const message = proto.Message.create({
		stickerMessage: sticker,
		audioStickerMessage: { message: proto.Message.create({ stickerMessage: sticker }) },
	} as any)
	return proto.Message.encode(message).finish()
}

Deno.test('audioSticker: encodes field 134 without duplicating the sticker', () => {
	const bytes = buildMessage()
	const wrapper = readField(bytes, 134)
	ok(wrapper, 'missing audioStickerMessage field 134')

	strictEqual(readField(bytes, 26), null, 'top-level stickerMessage must not be on the wire')

	const inner = readField(wrapper!, 1)
	ok(inner, 'missing FutureProofMessage.message')
	const sticker = readField(inner!, 26)
	ok(sticker, 'missing nested stickerMessage')
	const audio = readField(sticker!, 26)
	ok(audio, 'missing nested audioMessage')
	strictEqual(proto.Message.AudioMessage.decode(audio!).seconds, 5)
})

Deno.test('audioSticker: decode exposes sticker and audio', () => {
	const decoded = proto.Message.decode(buildMessage()) as any
	ok(decoded.stickerMessage, 'missing stickerMessage after decode')
	ok(decoded.audioStickerMessage, 'missing audioStickerMessage after decode')
	strictEqual(decoded.stickerMessage.audioMessage?.seconds, 5)
})

Deno.test('audioSticker: leaves normal messages untouched', () => {
	const bytes = proto.Message.encode({ conversation: 'hello' }).finish()
	const decoded = proto.Message.decode(bytes) as any
	strictEqual(decoded.conversation, 'hello')
	strictEqual(decoded.audioStickerMessage, undefined)
})

Deno.test('audioSticker: builder emits field 134', async () => {
	const upload: WAMediaUploadFunction = () =>
		Promise.resolve({
			mediaUrl: 'https://mmg.whatsapp.net/test',
			directPath: '/test',
		})
	const full = await buildAudioStickerMessage({
		jid: '123@s.whatsapp.net',
		userJid: 'me@s.whatsapp.net',
		sticker: Buffer.from('sticker-bytes'),
		audio: Buffer.from('audio-bytes'),
		seconds: 5,
		isAnimated: true,
		upload,
	})

	const bytes = proto.Message.encode(full.message!).finish()
	const wrapper = readField(bytes, 134)
	ok(wrapper, 'builder did not emit field 134')
	strictEqual(readField(bytes, 26), null, 'builder leaked a top-level stickerMessage')
})
