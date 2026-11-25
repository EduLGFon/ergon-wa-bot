// msgs tests - view-once wrapper typing, stub guards and media-key checks
import { getMsgType, hasUsableMediaKeys, isViewOnceContent } from '@util/msgTools.ts'
import { strictEqual } from 'node:assert/strict'

function wrap(wrapper: string, inner: any): any {
	return { [wrapper]: { message: inner } }
}

Deno.test('msgs: view-once wrappers map to the inner media type', () => {
	const cases: [string, any, string, string][] = [
		['viewOnceMessageV2', { imageMessage: { url: 'u' } }, 'image', 'imageMessage'],
		['viewOnceMessage', { videoMessage: { url: 'u' } }, 'video', 'videoMessage'],
		['viewOnceMessageV2Extension', { audioMessage: { url: 'u' } }, 'audio', 'audioMessage'],
		['viewOnceMessageV2', { stickerMessage: { url: 'u' } }, 'sticker', 'stickerMessage'],
		['viewOnceMessageV2', { documentMessage: { url: 'u' } }, 'document', 'documentMessage'],
	]
	for (const [wrapper, inner, type, raw] of cases) {
		const result = getMsgType(wrap(wrapper, inner))
		strictEqual(result[0], type)
		strictEqual(result[1], raw)
	}
})

Deno.test('msgs: view-once wrapper behind an ephemeral layer keeps the inner type', () => {
	const nested = {
		ephemeralMessage: {
			message: { viewOnceMessageV2: { message: { videoMessage: { url: 'u' } } } },
		},
	}
	const result = getMsgType(nested as any)
	strictEqual(result[0], 'video')
	strictEqual(result[1], 'videoMessage')
})

Deno.test('msgs: empty view-once stubs are not classified as media', () => {
	const stubs = [
		{ viewOnceMessageV2: {} },
		{ viewOnceMessageV2: { message: {} } },
		{ viewOnceMessageV2: { message: null } },
		{ viewOnceMessage: {} },
	]
	for (const stub of stubs) strictEqual(getMsgType(stub as any)[0], 'event')
})

Deno.test('msgs: view-once text content is typed as text', () => {
	const result = getMsgType(wrap('viewOnceMessageV2', { conversation: 'hi' }) as any)
	strictEqual(result[0], 'text')
	strictEqual(result[1], 'conversation')
})

Deno.test('msgs: isViewOnceContent detects wrappers and media flags', () => {
	strictEqual(isViewOnceContent(wrap('viewOnceMessageV2', { imageMessage: {} })), true)
	strictEqual(
		isViewOnceContent({
			ephemeralMessage: {
				message: { viewOnceMessage: { message: { imageMessage: {} } } },
			},
		}),
		true,
	)
	strictEqual(isViewOnceContent({ imageMessage: { url: 'u' } }), false)
	strictEqual(isViewOnceContent({ imageMessage: { url: 'u', viewOnce: true } }), true)
	strictEqual(isViewOnceContent({ conversation: 'hi' }), false)
})

Deno.test('msgs: hasUsableMediaKeys requires a URL and a non-empty key', () => {
	strictEqual(hasUsableMediaKeys({ url: 'u', mediaKey: new Uint8Array([1]) }), true)
	strictEqual(hasUsableMediaKeys({ url: 'u', mediaKey: 'abc' }), true)
	strictEqual(hasUsableMediaKeys({ url: 'u', mediaKey: new Uint8Array() }), false)
	strictEqual(hasUsableMediaKeys({ url: 'u' }), false)
	strictEqual(hasUsableMediaKeys({ mediaKey: new Uint8Array([1]) }), false)
	strictEqual(hasUsableMediaKeys({ url: '   ', mediaKey: new Uint8Array([1]) }), false)
	strictEqual(hasUsableMediaKeys(undefined), false)
})
