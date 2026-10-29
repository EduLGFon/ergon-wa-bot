// stt - speech-to-text adapters with pt-BR focus
// - preprocesses audio with ffmpeg, dispatches to the best available provider
import { createPartFromUri, FileState, GoogleGenAI } from '@google/genai'

const GoogleAI = new GoogleGenAI({ apiKey: Deno.env.get('GEMINI') })

export type SttResult = { text: string; provider: string; durationMs: number }

function pickProvider(forced?: string): string {
	if (forced) return forced
	if (Deno.env.get('TRANSCRYPT_PROVIDER')) return Deno.env.get('TRANSCRYPT_PROVIDER')!
	// Highest accuracy first, gated by available keys.
	if (Deno.env.get('OPENAI_API_KEY')) return 'openai'
	if (Deno.env.get('ELEVENLABS_API_KEY')) return 'elevenlabs'
	if (Deno.env.get('AZURE_SPEECH_KEY') && Deno.env.get('AZURE_SPEECH_REGION')) return 'azure'
	if (Deno.env.get('GROQ_API_KEY')) return 'groq'
	if (Deno.env.get('GEMINI')) return 'gemini'
	return 'gemini'
}

export function selectedProvider(forced?: string): string {
	return pickProvider(forced)
}

export function providerChain(primary: string): string[] {
	const all = ['openai', 'elevenlabs', 'azure', 'groq', 'gemini']
	const ordered = [primary, ...all.filter((p) => p !== primary)]
	return ordered.filter((p) => isAvailable(p))
}

function isAvailable(p: string): boolean {
	switch (p) {
		case 'openai':
			return !!Deno.env.get('OPENAI_API_KEY')
		case 'elevenlabs':
			return !!Deno.env.get('ELEVENLABS_API_KEY')
		case 'azure':
			return !!Deno.env.get('AZURE_SPEECH_KEY') && !!Deno.env.get('AZURE_SPEECH_REGION')
		case 'groq':
			return !!Deno.env.get('GROQ_API_KEY')
		case 'gemini':
			return !!Deno.env.get('GEMINI')
	}
	return false
}

export async function preprocess(media: { buffer: Uint8Array; mime: string }): Promise<Uint8Array> {
	// Write input to temp file, convert to 16kHz mono flac via ffmpeg.
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
		// fallback: return original buffer
		await Deno.remove(outPath).catch(() => {})
		return media.buffer
	}
	const out = await Deno.readFile(outPath)
	await Deno.remove(outPath).catch(() => {})
	return out
}

async function uploadGemini(buffer: Uint8Array, mime: string) {
	let upload = await GoogleAI.files.upload({
		file: new Blob([buffer as BlobPart]),
		config: { mimeType: mime },
	})
	upload = await GoogleAI.files.get({ name: upload.name! })
	let polls = 0
	while (upload.state === FileState.PROCESSING && polls < 30) {
		await new Promise((r) => setTimeout(r, 2000))
		upload = await GoogleAI.files.get({ name: upload.name! })
		polls++
	}
	if (upload.state === FileState.FAILED || upload.state === FileState.PROCESSING) {
		throw new Error('Gemini file processing failed')
	}
	return upload
}

async function geminiTranscribe(
	buffer: Uint8Array,
	lang: string,
	prompt?: string,
): Promise<SttResult> {
	const t0 = Date.now()
	const upload = await uploadGemini(buffer, 'audio/flac')
	const model = 'gemini-2.5-flash'
	const res = await GoogleAI.models.generateContent({
		model,
		contents: [
			createPartFromUri(upload.uri!, upload.mimeType!),
			`Transcribe this audio to text. Language: ${lang}. Return only the transcript, no commentary. ${
				prompt ?? ''
			}`,
		],
	})
	const text = (res.text ?? '').trim()
	if (!text) throw new Error('empty transcript')
	return { text, provider: 'gemini', durationMs: Date.now() - t0 }
}

async function openaiTranscribe(
	buffer: Uint8Array,
	lang: string,
	prompt?: string,
): Promise<SttResult> {
	const t0 = Date.now()
	const key = Deno.env.get('OPENAI_API_KEY')!
	const form = new FormData()
	form.append('file', new Blob([buffer as BlobPart], { type: 'audio/flac' }), 'audio.flac')
	form.append('model', 'gpt-4o-transcribe')
	form.append('language', lang.split('-')[0])
	if (prompt) form.append('prompt', prompt)
	const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
		method: 'POST',
		headers: { Authorization: `Bearer ${key}` },
		body: form,
		signal: AbortSignal.timeout(120_000),
	})
	if (!res.ok) throw new Error(`openai ${res.status}`)
	const data = await res.json()
	const text = (data?.text ?? '').trim()
	if (!text) throw new Error('empty transcript')
	return { text, provider: 'openai', durationMs: Date.now() - t0 }
}

async function groqTranscribe(
	buffer: Uint8Array,
	lang: string,
	prompt?: string,
): Promise<SttResult> {
	const t0 = Date.now()
	const key = Deno.env.get('GROQ_API_KEY')!
	const form = new FormData()
	form.append('file', new Blob([buffer as BlobPart], { type: 'audio/flac' }), 'audio.flac')
	form.append('model', 'whisper-large-v3-turbo')
	form.append('language', lang.split('-')[0])
	if (prompt) form.append('prompt', prompt)
	const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
		method: 'POST',
		headers: { Authorization: `Bearer ${key}` },
		body: form,
		signal: AbortSignal.timeout(120_000),
	})
	if (!res.ok) throw new Error(`groq ${res.status}`)
	const data = await res.json()
	const text = (data?.text ?? '').trim()
	if (!text) throw new Error('empty transcript')
	return { text, provider: 'groq', durationMs: Date.now() - t0 }
}

async function elevenlabsTranscribe(buffer: Uint8Array, lang: string): Promise<SttResult> {
	const t0 = Date.now()
	const key = Deno.env.get('ELEVENLABS_API_KEY')!
	const form = new FormData()
	form.append('file', new Blob([buffer as BlobPart], { type: 'audio/flac' }), 'audio.flac')
	form.append('model_id', 'scribe_v1')
	form.append('language_code', lang)
	const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
		method: 'POST',
		headers: { 'xi-api-key': key },
		body: form,
		signal: AbortSignal.timeout(120_000),
	})
	if (!res.ok) throw new Error(`elevenlabs ${res.status}`)
	const data = await res.json()
	const text = (data?.text ?? '').trim()
	if (!text) throw new Error('empty transcript')
	return { text, provider: 'elevenlabs', durationMs: Date.now() - t0 }
}

export async function transcribe(opts: {
	buffer: Uint8Array
	mime: string
	lang: string
	mode: 'raw' | 'clean' | 'best'
	prompt?: string
	forcedProvider?: string
}): Promise<SttResult> {
	const primary = pickProvider(opts.forcedProvider)
	const chain = providerChain(primary)
	let lastErr: unknown
	for (const p of chain) {
		try {
			switch (p) {
				case 'openai':
					return await openaiTranscribe(opts.buffer, opts.lang, opts.prompt)
				case 'elevenlabs':
					return await elevenlabsTranscribe(opts.buffer, opts.lang)
				case 'groq':
					return await groqTranscribe(opts.buffer, opts.lang, opts.prompt)
				case 'gemini':
					return await geminiTranscribe(opts.buffer, opts.lang, opts.prompt)
				case 'azure':
					throw new Error('azure adapter not implemented')
			}
		} catch (e) {
			lastErr = e
			print('STT', `${p} failed: ${e}`, 'red')
		}
	}
	throw lastErr ?? new Error('no provider available')
}


