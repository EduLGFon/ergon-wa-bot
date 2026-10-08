// Language command: instant-set on valid code/number/name, numbered picker otherwise.
// Stateless by design so it works the same in DMs and groups with no pending state.
import { type CmdCtx } from '@conf/types/types.d.ts'
import { languages } from '@util/locale.ts'
import { getFixedT } from 'i18next'
import Cmd from '@class/cmd.ts'

export default class extends Cmd {
	constructor() {
		super({ alias: ['lang'] })
	}

	// deno-lint-ignore require-await
	async run({ t, args, send, user }: CmdCtx) {
		const ordered = [...languages].sort()
		const resolved = resolveLang(args[0], ordered)
		if (resolved) {
			user.lang = resolved // setter lang() will also change it on DB, if there is one
			send(t('language.changed', { lng: user.lang.encode() }))
			return
		}

		const list = ordered.map((code, i) => `${i + 1}. ${t(`langs.${code}`)} (${code})`).join(
			'\n',
		)
		const current = t(`langs.${user.lang}`)
		// Bare .lang asks; unknown input re-asks with an invalid notice.
		if (!args[0]) return send(t('language.ask', { current, list, prefix: user.prefix }))
		return send(t('language.invalid', { input: args[0], current, list, prefix: user.prefix }))
	}
}

// Normalize for diacritic/case-insensitive name matching (e.g. portugues == portugues).
function normalize(value: str): str {
	return value.toLowerCase().trim().normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

// Accept codes (en), numbers (1..N) and native names (english/ingles) in any locale.
function resolveLang(raw: str | undefined, ordered: str[]): str | null {
	if (!raw) return null

	const input = raw.toLowerCase().trim()
	if (languages.includes(input)) return input

	const num = Number(input)
	if (Number.isInteger(num) && num >= 1 && num <= ordered.length) return ordered[num - 1]

	const norm = normalize(input)
	for (const code of languages) {
		for (const lng of languages) {
			if (normalize(getFixedT(lng)(`langs.${code}`)) === norm) return code
		}
	}

	return null
}
