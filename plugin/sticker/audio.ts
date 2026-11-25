//
// Audio sidecar extraction for WhatsApp sound stickers.
//
// The visual is encoded by the sticker engine; this module only pulls the
// audio track (up to the animated-sticker cap) into OGG/Opus for the embedded
// AudioMessage, padding short tracks so they never end before the video.
//
import { STICKER_MAX_DURATION_S } from '@plugin/sticker/limits.ts'
import { FFMPEG } from '@plugin/sticker/ffmpeg.ts'

const TIMEOUT_MS = 30_000

export interface ExtractAudioOptions {
	tempDir: string
	maxSeconds: number
	/**
	 * Output duration. When set, the track is padded with silence and cut at
	 * this many seconds so it never ends before the animated sticker.
	 */
	targetSeconds?: number
}

/**
 * Extract a short OGG/Opus mono track from a video buffer.
 *
 * Returns null when the input has no audio stream; unexpected ffmpeg failures
 * still throw so a missing binary or broken environment is not hidden.
 */
export async function extractAudio(
	input: Uint8Array,
	{ tempDir, maxSeconds, targetSeconds }: ExtractAudioOptions,
): Promise<Buffer | null> {
	const id = crypto.randomUUID()
	const inputPath = `${tempDir}/snd_${id}.bin`
	const outputPath = `${tempDir}/snd_${id}.ogg`

	// The input read and the padded output both stay inside the WhatsApp cap.
	const inputCapS = Math.min(maxSeconds, STICKER_MAX_DURATION_S)
	const outputCapS = targetSeconds && targetSeconds > 0
		? Math.min(STICKER_MAX_DURATION_S, Math.max(1, targetSeconds))
		: null

	await Deno.writeFile(inputPath, input)
	try {
		let proc: Deno.CommandOutput
		try {
			proc = await new Deno.Command(FFMPEG, {
				args: [
					'-y',
					'-hide_banner',
					'-loglevel',
					'error',
					'-t',
					String(inputCapS),
					'-i',
					inputPath,
					...(outputCapS === null ? [] : ['-af', 'apad', '-t', String(outputCapS)]),
					'-vn',
					'-ac',
					'1',
					'-ar',
					'48000',
					'-c:a',
					'libopus',
					'-b:a',
					'48k',
					'-f',
					'ogg',
					outputPath,
				],
				stdin: 'null',
				stdout: 'piped',
				stderr: 'piped',
				signal: AbortSignal.timeout(TIMEOUT_MS),
			}).output()
		} catch (e) {
			if ((e as Error)?.name === 'TimeoutError') return null
			throw e
		}

		// Non-zero is the normal "no audio stream" path for silent videos.
		if (!proc.success) return null

		const data = await Deno.readFile(outputPath).catch(() => null)
		return data?.length ? Buffer.from(data) : null
	} finally {
		await Deno.remove(inputPath).catch(() => {})
		await Deno.remove(outputPath).catch(() => {})
	}
}
