// Shared sticker duration limit tests.
// Guards the WhatsApp 10s cap and every path that must use the same constant.
import { buildAudioStickerMessage } from '@plugin/sticker/audioSticker.ts'
import { STICKER_MAX_DURATION_S } from '@plugin/sticker/limits.ts'
import { match, ok, strictEqual } from 'node:assert/strict'
import type { WAMediaUploadFunction } from 'baileys'

/** Run the builder and read back the encoded AudioMessage seconds. */
async function builtSeconds(seconds: number): Promise<number | undefined> {
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
		seconds,
		isAnimated: true,
		upload,
	})
	return (full.message?.stickerMessage as any)?.audioMessage?.seconds ?? undefined
}

Deno.test('duration: shared cap is the WhatsApp 10s animated limit', () => {
	strictEqual(STICKER_MAX_DURATION_S, 10)
})

Deno.test('duration: audioSticker clamps seconds to the shared cap', async () => {
	strictEqual(await builtSeconds(42), STICKER_MAX_DURATION_S)
	strictEqual(await builtSeconds(6), 6)
	strictEqual(await builtSeconds(0), 1)
})

Deno.test('duration: sticker command ties extraction and metadata to the cap', async () => {
	const source = await Deno.readTextFile(
		new URL('../../cmd/fun/sticker.ts', import.meta.url),
	)
	match(source, /maxSeconds:\s*STICKER_MAX_DURATION_S/)
	match(source, /targetSeconds:\s*targetS/)
	match(source, /seconds\s*=\s*targetS/)
	ok(!/maxSeconds:\s*5\b/.test(source), 'stale 5s cap in the sticker command')
})
