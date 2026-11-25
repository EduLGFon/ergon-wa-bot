//
// WhatsApp sound stickers (audio stickers).
//
// WAProto in Baileys rc14 does not know Message field 134
// (audioStickerMessage) or StickerMessage field 26 (audioMessage), so the
// generated codecs are patched at runtime. The patch is idempotent and should
// be deleted once WAProto ships these fields.
//
import { generateWAMessageFromContent, prepareWAMessageMedia, proto } from 'baileys'
import type { WAMediaUploadFunction, WAMessage } from 'baileys'
import { STICKER_MAX_DURATION_S } from '@plugin/sticker/limits.ts'

const TAG_AUDIO_STICKER = 134 * 8 + 2
const TAG_STICKER_AUDIO = 26 * 8 + 2
const TAG_FP_MESSAGE = 1 * 8 + 2
const PATCH_FLAG = '__ergonAudioStickerPatched'

export interface AudioStickerInput {
	jid: string
	userJid: string
	sticker: Buffer
	audio: Buffer
	seconds: number
	isAnimated: boolean
	upload: WAMediaUploadFunction
	quoted?: proto.IWebMessageInfo
}

export function installAudioStickerProto(): void {
	const M = proto.Message as any
	if (M[PATCH_FLAG]) return
	M[PATCH_FLAG] = true

	const Sticker = M.StickerMessage
	const Audio = M.AudioMessage

	const encodeSticker = Sticker.encode.bind(Sticker)
	Sticker.encode = (m: any, w: any) => {
		w = encodeSticker(m, w)
		if (m?.audioMessage != null) {
			w.uint32(TAG_STICKER_AUDIO).fork()
			Audio.encode(m.audioMessage, w)
			w.ldelim()
		}
		return w
	}

	const encodeMessage = M.encode.bind(M)
	M.encode = (m: any, w: any) => {
		if (!m?.audioStickerMessage) return encodeMessage(m, w)

		// Keep stickerMessage in the object so Baileys classifies the stanza as
		// media/sticker, but do not duplicate its bytes on the wire.
		const rest = { ...m }
		const wrapper = rest.audioStickerMessage
		delete rest.stickerMessage
		delete rest.audioStickerMessage
		w = encodeMessage(rest, w)
		w.uint32(TAG_AUDIO_STICKER).fork()
		w.uint32(TAG_FP_MESSAGE).fork()
		encodeMessage(wrapper.message, w)
		w.ldelim()
		w.ldelim()
		return w
	}

	const decodeMessage = M.decode.bind(M)
	M.decode = (reader: any, length?: number) => {
		const isBuffer = reader instanceof Uint8Array
		const raw = isBuffer
			? reader
			: reader.buf.subarray(reader.pos, reader.pos + (length ?? reader.len - reader.pos))
		const decoded: any = decodeMessage(reader, length)
		const wrapper = readField(raw, 134)
		if (!wrapper) return decoded

		const innerBytes = readField(wrapper, 1)
		if (!innerBytes) return decoded

		const inner: any = decodeMessage(innerBytes)
		decoded.audioStickerMessage = { message: inner }
		if (inner?.stickerMessage) {
			decoded.stickerMessage = inner.stickerMessage
			// StickerMessage.decode drops the unknown audio field; expose it for
			// callers that want to download or relay the sound later.
			const stickerBytes = readField(innerBytes, 26)
			const audioBytes = stickerBytes ? readField(stickerBytes, 26) : null
			if (audioBytes) inner.stickerMessage.audioMessage = Audio.decode(audioBytes)
		}
		return decoded
	}
}

/**
 * Build a sound sticker message. The caller relays the returned message so
 * Baileys still handles device fanout and group encryption.
 */
export async function buildAudioStickerMessage(input: AudioStickerInput): Promise<WAMessage> {
	installAudioStickerProto()

	const stickerMedia = await prepareWAMessageMedia(
		{ sticker: input.sticker },
		{ upload: input.upload },
	)
	const audioMedia = await prepareWAMessageMedia(
		{
			audio: input.audio,
			mimetype: 'audio/ogg; codecs=opus',
			ptt: false,
			seconds: Math.min(STICKER_MAX_DURATION_S, Math.max(1, Math.round(input.seconds))),
		},
		{ upload: input.upload },
	)

	const stickerMessage = stickerMedia.stickerMessage
	const audioMessage = audioMedia.audioMessage
	if (!stickerMessage || !audioMessage) throw new Error('audio sticker media upload failed')

	stickerMessage.isAnimated = input.isAnimated
	;(stickerMessage as any).audioMessage = audioMessage

	const content = {
		stickerMessage,
		audioStickerMessage: {
			message: proto.Message.create({ stickerMessage }),
		},
		messageContextInfo: {
			messageSecret: crypto.getRandomValues(new Uint8Array(32)),
		},
	} as unknown as proto.IMessage

	return generateWAMessageFromContent(input.jid, content, {
		userJid: input.userJid,
		quoted: input.quoted as any,
	})
}

/** Read one top-level protobuf field without a schema. */
function readField(buf: Uint8Array, id: number): Uint8Array | null {
	try {
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
				if (end > buf.length) return null
				if (field === id) return buf.subarray(pos, end)
				pos = end
			} else if (wire === 5) {
				pos += 4
			} else {
				return null
			}
		}
	} catch {
		// Best-effort unknown-field scan; malformed input keeps the normal decode.
	}
	return null
}

function readVarint(buf: Uint8Array, start: number): [number, number] {
	let value = 0
	let shift = 0
	let pos = start
	while (pos < buf.length) {
		const byte = buf[pos++]
		value += (byte & 0x7f) * 2 ** shift
		if ((byte & 0x80) === 0) return [value, pos]
		shift += 7
		if (shift > 63) break
	}
	throw new Error('truncated varint')
}
