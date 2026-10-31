// stt - local speech-to-text via faster-whisper (no online APIs / AI)
// - preprocesses audio with ffmpeg, runs faster-whisper in the python venv
// - keeps a long-lived daemon so the model is loaded only once
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
		signal: AbortSignal.timeout(60_000),
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

// Daemon singleton
let daemonProc: Deno.ChildProcess | null = null
let daemonReader: ReadableStreamDefaultReader<Uint8Array> | null = null
let daemonWriter: WritableStreamDefaultWriter<Uint8Array> | null = null
let daemonBusy = false
const daemonQueue: Array<() => void> = []

function ensureDaemon(): void {
	if (daemonProc) return
	const proc = new Deno.Command(PY, {
		args: [SCRIPT, '--daemon'],
		stdin: 'piped',
		stdout: 'piped',
		stderr: 'inherit',
	}).spawn()
	daemonProc = proc
	daemonReader = proc.stdout.getReader()
	daemonWriter = proc.stdin.getWriter()
}

async function daemonTranscribe(audioPath: string, lang: string, model: string): Promise<any> {
	// Serialize requests
	while (daemonBusy) {
		await new Promise<void>((resolve) => daemonQueue.push(resolve))
	}
	daemonBusy = true
	try {
		ensureDaemon()
		const line = `${audioPath}\t${lang}\t${model}\tint8\n`
		await daemonWriter!.write(new TextEncoder().encode(line))
		// read one response line
		let buf = ''
		while (true) {
			const { value, done } = await daemonReader!.read()
			if (done) throw new Error('daemon closed')
			buf += new TextDecoder().decode(value)
			const nl = buf.indexOf('\n')
			if (nl !== -1) {
				const resp = buf.slice(0, nl)
				// leave remainder (none expected)
				const parsed = JSON.parse(resp)
				if (parsed?.error) throw new Error(parsed.error)
				return parsed
			}
		}
	} finally {
		daemonBusy = false
		const next = daemonQueue.shift()
		if (next) next()
	}
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
	let parsed: any
	try {
		parsed = await daemonTranscribe(audioPath, opts.lang, model)
	} catch (_e) {
		// Fall back to one-shot invocation
		const cmd = new Deno.Command(PY, {
			args: [SCRIPT, audioPath, opts.lang, model, 'int8'],
			stdout: 'piped',
			stderr: 'piped',
			signal: AbortSignal.timeout(300_000),
		})
		const { code, stdout, stderr } = await cmd.output()
		if (code !== 0) {
			throw new Error(new TextDecoder().decode(stderr) || `whisper exit ${code}`)
		}
		parsed = JSON.parse(new TextDecoder().decode(stdout))
		if (parsed?.error) throw new Error(parsed.error)
	} finally {
		await Deno.remove(audioPath).catch(() => {})
	}
	const text = (parsed?.text ?? '').trim()
	if (!text) throw new Error('empty transcript')
	return { text, provider: `faster-whisper/${model}`, durationMs: Date.now() - t0 }
}
