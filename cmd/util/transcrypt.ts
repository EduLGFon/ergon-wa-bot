// Transcrypt command - transcribes audio/voice/video media to text
// Optimized for Brazilian Portuguese accuracy via best available STT provider
import { type CmdCtx } from '@conf/types/types.d.ts'
import { getMedia } from '@util/msgAbstractions.ts'
import { preprocess, providerChain, selectedProvider, transcribe } from '@util/stt.ts'
import { GoogleGenAI } from '@google/genai'
import cache from '@plugin/cache.ts'
import Cmd from '@class/cmd.ts'

const GoogleAI = new GoogleGenAI({ apiKey: Deno.env.get('GEMINI') })

const LANG_MAP: Record<string, string> = {
	pt: 'pt-BR',
	'pt-br': 'pt-BR',
	en: 'en-US',
	es: 'es-ES',
	fr: 'fr-FR',
	de: 'de-DE',
}

function normalizeLang(input?: string): string {
	if (!input) return 'pt-BR'
	const v = input.toLowerCase()
	return LANG_MAP[v] ?? input
}

async function geminiClean(text: string, lang: string): Promise<string> {
	const res = await GoogleAI.models.generateContent({
		model: 'gemini-2.5-flash',
		contents: [
			`Você é um corretor de transcrição. Corrija apenas pontuação, maiúsculas e erros óbvios de reconhecimento. Não adicione, remova ou parafraseie conteúdo. Preserve nomes próprios. Responda só com a transcrição corrigida. Idioma: ${lang}.\n\n${text}`,
		],
	})
	return (res.text ?? text).trim()
}

async function geminiReconcile(a: string, b: string, lang: string): Promise<string> {
	const res = await GoogleAI.models.generateContent({
		model: 'gemini-2.5-flash',
		contents: [
			`Duas transcrições do mesmo áudio (${lang}). Produza a versão mais precisa, combinando-as, corrigindo apenas erros óbvios. Não invente conteúdo. Responda só com a transcrição final.\n\nA:\n${a}\n\nB:\n${b}`,
		],
	})
	return (res.text ?? a).trim()
}

export default class extends Cmd {
	constructor() {
		super({
			alias: ['tr', 'transc', 'stt'],
			cooldown: 10_000,
		})
	}

	async run({ msg, args, user, send, react, startTyping, t }: CmdCtx) {
		const media = await getMedia(msg).catch(() => null)
		if (!media) return send('transcrypt.nobuffer', { user, quoted: msg })

		const modes = new Set(['raw', 'clean', 'best'])
		let mode: 'raw' | 'clean' | 'best' = 'raw'
		let lang = 'pt-BR'
		let forcedProvider: string | undefined
		for (const a of args) {
			const low = a.toLowerCase()
			if (modes.has(low)) mode = low as any
			else if (low.startsWith('lang=')) lang = normalizeLang(low.slice(5))
			else if (low.startsWith('provider=')) forcedProvider = low.slice(9)
			else if (!low.includes('=')) {
				// treat first bare token as language
				if (lang === 'pt-BR' && !modes.has(low)) lang = normalizeLang(low)
			}
		}

		if (media.length && media.length > 25 * 1024 * 1024) {
			return send('transcrypt.tooLarge', { user, quoted: msg })
		}

		await startTyping()
		await react('loading').catch(() => {})

		const cacheKey = `${media.url}|${selectedProvider(forcedProvider)}|${lang}|${mode}`
		const cached = cache.transcripts.get(cacheKey)
		if (cached) {
			return send(
				`*[🎙️] - ${t('transcrypt.header', { provider: 'cache', lang })}*\n${cached}`,
				{
					quoted: msg,
				},
			)
		}

		try {
			const rawBuffer = media.buffer
			const processed = await preprocess({ buffer: rawBuffer, mime: media.mime })
			const prompt = media.target?.text ? `Contexto: ${media.target.text}` : undefined

			const primary = await transcribe({
				buffer: processed,
				mime: 'audio/flac',
				lang,
				mode,
				prompt,
				forcedProvider,
			})

			let finalText = primary.text
			let providerLabel = primary.provider

			if (mode === 'clean' && Deno.env.get('GEMINI')) {
				finalText = await geminiClean(finalText, lang)
			}

			if (mode === 'best') {
				// run second provider
				const chain = providerChain(primary.provider).filter((p) => p !== primary.provider)
				if (chain.length && Deno.env.get('GEMINI')) {
					try {
						const second = await transcribe({
							buffer: processed,
							mime: 'audio/flac',
							lang,
							mode: 'raw',
							prompt,
							forcedProvider: chain[0],
						})
						finalText = await geminiReconcile(primary.text, second.text, lang)
						providerLabel = `${primary.provider}+${second.provider}`
					} catch (e) {
						print('TRANSCRYPT', e, 'red')
					}
				}
			}

			cache.transcripts.set(cacheKey, finalText)

			const header = `*[🎙️] - Transcription (${providerLabel}, ${lang})*`
			if (finalText.length > 4000) {
				// send as document
				await send(
					{
						document: new Blob([finalText], { type: 'text/plain' }),
						fileName: 'transcript.txt',
						caption: header,
					} as any,
					{ quoted: msg },
				)
			} else {
				await send(`${header}\n${finalText}`, { quoted: msg })
			}
			await react('ok').catch(() => {})
		} catch (e) {
			print('TRANSCRYPT', e, 'red')
			await react('x').catch(() => {})
			await send('transcrypt.failed', { user, quoted: msg })
		}
	}
}
