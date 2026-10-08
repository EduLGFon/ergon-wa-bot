// Relay notices and shared helpers - topic warnings and transcoding.
// Hyphen-only header - plain ASCII dashes for all punctuation.
import { limiterFor } from '../wa-to-tg/state.ts'
import type { RateLimiter } from '../rate-limiter.ts'
import { formatBytes } from '../format.ts'
import { Bot } from 'grammy'

function sizeSuffix(bytes: number | null): string {
	return bytes != null ? ` (${formatBytes(bytes)})` : ''
}

// Topic notice for a failed Telegram download. tooLarge names the 20 MB
// cap and the fix (send it smaller / as a link); other failures name the
// attachment kind and size when known.
export function tgDownloadFailureLine(
	label: string,
	bytes: number | null,
	tooLarge: boolean,
): string {
	// Article keys off "Telegram" (consonant), not the label.
	if (tooLarge) {
		return `⚠️ A Telegram ${label}${
			sizeSuffix(bytes)
		} exceeds the 20 MB bot download limit - it didn't cross.`
	}
	return `⚠️ Couldn't download a Telegram ${label}${sizeSuffix(bytes)} - it didn't cross.`
}

// Best-effort notice to the affected topic so a relay failure is visible
// where the user looks, not just in server logs. Never throws and never
// loops (the message handler ignores the bot's own messages).
export async function notifyTopic(
	tg: Bot,
	tgLimiter: RateLimiter,
	chatId: string | number,
	topicId: number,
	line: string,
): Promise<void> {
	try {
		// Route by destination group so business warnings never consume
		// personal budget. The passed limiter is the pre-boot fallback.
		await (limiterFor(chatId) ?? tgLimiter).enqueue(
			() =>
				tg.api.sendMessage(chatId, line, {
					message_thread_id: topicId,
				}),
			'notice',
		)
	} catch {
		// The notice itself failed - the server log already has the details.
	}
}

// First line of an error, capped - for topic notices, not logs.
export function shortErr(e: unknown): string {
	const raw = typeof e === 'string'
		? e
		: ((e as { description?: unknown; message?: unknown })?.description ??
			(e as { message?: unknown })?.message ??
			String(e))
	return String(raw).split('\n')[0].slice(0, 160) || 'unknown error'
}

// Transcode a Telegram video (.webm) sticker to an animated WebP WhatsApp
// sticker (512px, looping, <=500KB). Async ffmpeg - never blocks the event
// loop. Returns null on any failure (no ffmpeg, undecodable input, still
// oversize after two quality levels) so the caller can fall back to video.
export async function convertWebmToStickerWebp(input: Uint8Array): Promise<Uint8Array | null> {
	const dir = await Deno.makeTempDir({ prefix: 'bridge-sticker-' })
	try {
		const inPath = `${dir}/in.webm`
		await Deno.writeFile(inPath, input)
		for (const [quality, fps] of [[60, 15], [25, 10]] as const) {
			const outPath = `${dir}/out_${quality}.webp`
			const proc = new Deno.Command('ffmpeg', {
				args: [
					'-y',
					'-t',
					'11',
					'-i',
					inPath,
					'-filter_complex',
					`[0:v]fps=${fps},scale=512:512:force_original_aspect_ratio=decrease,format=yuva420p,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000[out]`,
					'-map',
					'[out]',
					'-c:v',
					'libwebp',
					'-loop',
					'0',
					'-an',
					'-quality',
					String(quality),
					'-compression_level',
					'4',
					'-preset',
					'icon',
					outPath,
				],
				stdin: 'null',
				stdout: 'null',
				stderr: 'null',
				signal: AbortSignal.timeout(60_000),
			})
			const { success } = await proc.output().catch(() => ({ success: false }))
			if (!success) continue
			const out = await Deno.readFile(outPath).catch((): Uint8Array | null => null)
			if (out && out.length > 0 && out.length <= 500 * 1024) return out
		}
		return null
	} catch {
		return null
	} finally {
		await Deno.remove(dir, { recursive: true }).catch(() => {})
	}
}
