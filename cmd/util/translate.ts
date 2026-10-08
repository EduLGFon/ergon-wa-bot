// Translate command - converts text via Google translate endpoint
// Needed for multilingual chats without npm deps, uses fetch
import { type CmdCtx } from '@conf/types/types.d.ts'
import Cmd from '@class/cmd.ts'

// Free Google endpoint used by web clients, no key needed.
async function googleTranslate(text: string, to: string): Promise<{ text: string; from: string }> {
	const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${
		encodeURIComponent(to)
	}&dt=t&q=${encodeURIComponent(text)}`
	const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
	if (!res.ok) throw new Error(`translate ${res.status}`)
	const data = await res.json()
	const out = (data?.[0] ?? []).map((s: unknown[]) => (s as string[])[0]).join('')
	const from = typeof data?.[2] === 'string' ? data[2] : 'auto'
	if (!out) throw new Error('empty translation')
	return { text: out, from }
}

export default class extends Cmd {
	constructor() {
		super({
			alias: ['t'],
			cooldown: 5_000,
		})
	}

	async run({ args, send, user, t }: CmdCtx) {
		if (!args[1]) return send('usage.translate', { user })

		const toLang = args.shift() // language to what the text will be translated
		if (!toLang) return send('usage.translate', { user })
		try {
			const output = await googleTranslate(args.join(' '), toLang)

			const text = `*[🌐] - ${t('translate.desc')}*\n` + // Google translate title
				`*${output.from}  ➟  ${toLang}*\n` + // lang identify
				output.text.encode() // translation

			send(text)
		} catch (e) {
			print('CMD/TRANSLATE', e, 'red')
			send('usage.translate', { user })
		}
	}
}
