// Audio sidecar extraction tests.
// Requires the same system ffmpeg + libopus used by the sticker worker.
import { STICKER_MAX_DURATION_S } from '@plugin/sticker/limits.ts'
import { extractAudio } from '@plugin/sticker/audio.ts'
import { ok, strictEqual } from 'node:assert/strict'
import { FFMPEG } from '@plugin/sticker/ffmpeg.ts'

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

async function generateSine(path: string, durationS: number): Promise<void> {
	const gen = await new Deno.Command(FFMPEG, {
		args: [
			'-y',
			'-hide_banner',
			'-loglevel',
			'error',
			'-f',
			'lavfi',
			'-i',
			`sine=frequency=440:duration=${durationS}`,
			'-c:a',
			'libopus',
			path,
		],
		stdout: 'null',
		stderr: 'piped',
	}).output()
	ok(gen.success, new TextDecoder().decode(gen.stderr).slice(-300))
}

/** Read the container duration with ffmpeg itself (ffprobe is not required). */
async function probeDurationS(path: string): Promise<number> {
	const proc = await new Deno.Command(FFMPEG, {
		args: ['-hide_banner', '-i', path, '-f', 'null', '-'],
		stdout: 'null',
		stderr: 'piped',
	}).output()
	const stderr = new TextDecoder().decode(proc.stderr)
	const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
	ok(match, `could not parse duration from ffmpeg: ${stderr.slice(-300)}`)
	const [, h, m, s] = match
	return Number(h) * 3600 + Number(m) * 60 + Number(s)
}

/** Extract a generated sine and return the sidecar duration in seconds. */
async function extractSineDuration(
	tempDir: string,
	sourceS: number,
	opts: { maxSeconds: number; targetSeconds?: number },
): Promise<{ audio: Buffer; durationS: number }> {
	const inputPath = `${tempDir}/in-${crypto.randomUUID()}.ogg`
	const outputPath = `${tempDir}/out-${crypto.randomUUID()}.ogg`
	await generateSine(inputPath, sourceS)

	const audio = await extractAudio(await Deno.readFile(inputPath), { tempDir, ...opts })
	ok(audio, 'extractAudio returned null')
	await Deno.writeFile(outputPath, audio!)
	return { audio, durationS: await probeDurationS(outputPath) }
}

function closeTo(actual: number, expected: number): boolean {
	return Math.abs(actual - expected) <= 0.35
}

Deno.test('audio: extracts an OGG/Opus track', { ignore: !ffmpegReady() }, async () => {
	const tempDir = await Deno.makeTempDir({ prefix: 'ergon-snd-' })
	try {
		const { audio, durationS } = await extractSineDuration(tempDir, 6, {
			maxSeconds: STICKER_MAX_DURATION_S,
		})
		strictEqual(new TextDecoder().decode(audio.subarray(0, 4)), 'OggS')
		ok(audio.length > 1_000, 'audio output is suspiciously small')
		ok(closeTo(durationS, 6), `expected ~6s, got ${durationS}s`)
	} finally {
		await Deno.remove(tempDir, { recursive: true }).catch(() => {})
	}
})

Deno.test(
	'audio: targetSeconds keeps a 6s track at 6s',
	{ ignore: !ffmpegReady() },
	async () => {
		const tempDir = await Deno.makeTempDir({ prefix: 'ergon-snd-' })
		try {
			const { durationS } = await extractSineDuration(tempDir, 6, {
				maxSeconds: STICKER_MAX_DURATION_S,
				targetSeconds: 6,
			})
			ok(closeTo(durationS, 6), `expected ~6s, got ${durationS}s`)
		} finally {
			await Deno.remove(tempDir, { recursive: true }).catch(() => {})
		}
	},
)

Deno.test('audio: maxSeconds caps a 12s track at 10s', { ignore: !ffmpegReady() }, async () => {
	const tempDir = await Deno.makeTempDir({ prefix: 'ergon-snd-' })
	try {
		const { durationS } = await extractSineDuration(tempDir, 12, {
			maxSeconds: STICKER_MAX_DURATION_S,
		})
		ok(closeTo(durationS, STICKER_MAX_DURATION_S), `expected ~10s, got ${durationS}s`)
	} finally {
		await Deno.remove(tempDir, { recursive: true }).catch(() => {})
	}
})

Deno.test('audio: pads a 4s track to a 6s target', { ignore: !ffmpegReady() }, async () => {
	const tempDir = await Deno.makeTempDir({ prefix: 'ergon-snd-' })
	try {
		const { durationS } = await extractSineDuration(tempDir, 4, {
			maxSeconds: STICKER_MAX_DURATION_S,
			targetSeconds: 6,
		})
		ok(closeTo(durationS, 6), `expected ~6s, got ${durationS}s`)
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
				maxSeconds: STICKER_MAX_DURATION_S,
			})
			strictEqual(audio, null)
		} finally {
			await Deno.remove(tempDir, { recursive: true }).catch(() => {})
		}
	},
)
