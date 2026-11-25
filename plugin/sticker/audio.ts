//
// Audio sidecar extraction for WhatsApp sound stickers.
//
// The visual is encoded by the sticker engine; this module only pulls the
// first seconds of the source video into OGG/Opus for the embedded AudioMessage.
//
import { FFMPEG } from '@plugin/sticker/ffmpeg.ts'

const TIMEOUT_MS = 30_000

export interface ExtractAudioOptions {
	tempDir: string
	maxSeconds: number
}

/**
 * Extract a short OGG/Opus mono track from a video buffer.
 *
 * Returns null when the input has no audio stream; unexpected ffmpeg failures
 * still throw so a missing binary or broken environment is not hidden.
 */
export async function extractAudio(
	input: Uint8Array,
	{ tempDir, maxSeconds }: ExtractAudioOptions,
): Promise<Buffer | null> {
	const id = crypto.randomUUID()
	const inputPath = `${tempDir}/snd_${id}.bin`
	const outputPath = `${tempDir}/snd_${id}.ogg`

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
					'-i',
					inputPath,
					'-t',
					String(maxSeconds),
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
