// Audio sidecar extraction tests.
// Requires the same system ffmpeg + libopus used by the sticker worker.
import { extractAudio } from '@plugin/sticker/audio.ts'
import { FFMPEG } from '@plugin/sticker/ffmpeg.ts'
import { ok, strictEqual } from 'node:assert/strict'

function ffmpegReady(): boolean {
	try {
		return new Deno.Command(FFMPEG, {
			args: ['-version'],
			stdout: 'null',
			stderr: 'null',
		}).outputSync().success
	} catch {
		return false
	}
}

Deno.test('audio: extracts an OGG/Opus track', { ignore: !ffmpegReady() }, async () => {
	const tempDir = await Deno.makeTempDir({ prefix: 'ergon-snd-' })
	const inputPath = `${tempDir}/in.ogg`
	try {
		const gen = await new Deno.Command(FFMPEG, {
			args: [
				'-y',
				'-hide_banner',
				'-loglevel',
				'error',
				'-f',
				'lavfi',
				'-i',
				'sine=frequency=440:duration=6',
				'-c:a',
				'libopus',
				inputPath,
			],
			stdout: 'null',
			stderr: 'piped',
		}).output()
		ok(gen.success, new TextDecoder().decode(gen.stderr).slice(-300))

		const audio = await extractAudio(await Deno.readFile(inputPath), {
			tempDir,
			maxSeconds: 5,
		})
		ok(audio, 'extractAudio returned null')
		strictEqual(new TextDecoder().decode(audio!.subarray(0, 4)), 'OggS')
		ok(audio!.length > 1_000, 'audio output is suspiciously small')
	} finally {
		await Deno.remove(tempDir, { recursive: true }).catch(() => {})
	}
})

Deno.test(
	'audio: returns null for a source without audio',
	{ ignore: !ffmpegReady() },
	async () => {
		const tempDir = await Deno.makeTempDir({ prefix: 'ergon-snd-' })
		try {
			const audio = await extractAudio(new TextEncoder().encode('not media'), {
				tempDir,
				maxSeconds: 5,
			})
			strictEqual(audio, null)
		} finally {
			await Deno.remove(tempDir, { recursive: true }).catch(() => {})
		}
	},
)
