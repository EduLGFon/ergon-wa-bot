// Transcrypt command - transcribes audio/voice/video media to text
// Local STT via faster-whisper (no online APIs), tuned for pt-BR
import { type CmdCtx } from '@conf/types/types.d.ts'
import { getMedia } from '@util/msgAbstractions.ts'
import { preprocess, selectedProvider, transcribe } from '@util/stt.ts'
import cache from '@plugin/cache.ts'
import Cmd from '@class/cmd.ts'

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

		if (media.length && media.length > 25 * 1024 * 1024) {
			return send('transcrypt.tooLarge', { user, quoted: msg })
		}

		const modes = new Set(['raw', 'clean', 'best'])
		let mode: 'raw' | 'clean' | 'best' = 'raw'
		let lang = 'pt-BR'
		for (const a of args) {
			const low = a.toLowerCase()
			if (modes.has(low)) mode = low as 'raw' | 'clean' | 'best'
			else if (low.startsWith('lang=')) lang = low.slice(5)
			else if (!low.includes('=')) {
				if (lang === 'pt-BR') lang = low
			}
		}
		// normalize common codes
		const LANG_MAP: Record<string, string> = {
			pt: 'pt',
			'pt-br': 'pt',
			en: 'en',
			es: 'es',
			fr: 'fr',
			de: 'de',
		}
		lang = LANG_MAP[lang.toLowerCase()] ?? lang

		await startTyping()
		await react('loading').catch(() => {})

		const cacheKey = `${media.url}|${selectedProvider()}|${lang}|${mode}`
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
			const processed = await preprocess({ buffer: media.buffer, mime: media.mime })
			const prompt = media.target?.text ? `Contexto: ${media.target.text}` : undefined

			const result = await transcribe({
				buffer: processed,
				mime: 'audio/flac',
				lang,
				mode,
				prompt,
			})

			cache.transcripts.set(cacheKey, result.text)

			const header = `*[🎙️] - Transcription (${result.provider}, ${lang})*`
			if (result.text.length > 4000) {
				await send(
					{
						document: new Blob([result.text], { type: 'text/plain' }),
						fileName: 'transcript.txt',
						caption: header,
					} as any,
					{ quoted: msg },
				)
			} else {
				await send(`${header}\n${result.text}`, { quoted: msg })
			}
			await react('ok').catch(() => {})
		} catch (e) {
			print('TRANSCRYPT', e, 'red')
			await react('x').catch(() => {})
			await send('transcrypt.failed', { user, quoted: msg })
		}
	}
}
