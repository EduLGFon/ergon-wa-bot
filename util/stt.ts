// stt - local speech-to-text via faster-whisper (no online APIs / AI)
// - preprocesses audio with ffmpeg, runs faster-whisper in the python venv
export type SttResult = { text: string; provider: string; durationMs: number }

const PY = 'conf/gen/python/bin/python3'
const SCRIPT = 'scripts/transcribe.py'

export function selectedProvider(_forced?: string): string {
	return 'faster-whisper'
}

export function providerChain(_primary: string): string[] {
	return ['faster-whisper']
}

export async function preprocess(media: { buffer: Uint8Array; mime: string }): Promise<Uint8Array> {
	const tmpDir = 'conf/gen/temp'
	await Deno.mkdir(tmpDir, { recursive: true })
	const inPath = `${tmpDir}/tc-in-${crypto.randomUUID()}`
	const outPath = `${tmpDir}/tc-out-${crypto.randomUUID()}.flac`
	await Deno.writeFile(inPath, media.buffer)
	const denoise = Deno.env.get('TRANSCRYPT_DENOISE') === '1'
	const af = denoise
		? 'afftdn=nf=-25,silenceremove=start_periods=1:start_silence=0.3:start_threshold=-40dB'
		: 'silenceremove=start_periods=1:start_silence=0.3:start_threshold=-40dB'
	const cmd = new Deno.Command('ffmpeg', {
		args: ['-y', '-i', inPath, '-ar', '16000', '-ac', '1', '-af', af, outPath],
		stdout: 'null',
		stderr: 'null',
	})
	const { code } = await cmd.output()
	await Deno.remove(inPath).catch(() => {})
	if (code !== 0) {
		await Deno.remove(outPath).catch(() => {})
		return media.buffer
	}
	const out = await Deno.readFile(outPath)
	await Deno.remove(outPath).catch(() => {})
	return out
}

export async function transcribe(opts: {
	buffer: Uint8Array
	mime: string
	lang: string
	mode: 'raw' | 'clean' | 'best'
	prompt?: string
	forcedProvider?: string
}): Promise<SttResult> {
	const t0 = Date.now()
	const tmpDir = 'conf/gen/temp'
	await Deno.mkdir(tmpDir, { recursive: true })
	const audioPath = `${tmpDir}/tc-audio-${crypto.randomUUID()}.flac`
	await Deno.writeFile(audioPath, opts.buffer)
	const model = Deno.env.get('TRANSCRYPT_MODEL') || 'medium'
	const cmd = new Deno.Command(PY, {
		args: [SCRIPT, audioPath, opts.lang, model, 'int8'],
		stdout: 'piped',
		stderr: 'piped',
	})
	const { code, stdout, stderr } = await cmd.output()
	await Deno.remove(audioPath).catch(() => {})
	if (code !== 0) {
		throw new Error(new TextDecoder().decode(stderr) || `whisper exit ${code}`)
	}
	const parsed = JSON.parse(new TextDecoder().decode(stdout))
	const text = (parsed?.text ?? '').trim()
	if (!text) throw new Error('empty transcript')
	return { text, provider: `faster-whisper/${model}`, durationMs: Date.now() - t0 }
}
