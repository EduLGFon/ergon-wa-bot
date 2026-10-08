// locale - i18next init from locale JSON files
// - discovers languages via Deno readDir with en fallback
// - uses a tiny Deno.readTextFile backend instead of npm fs backend
import i18next from 'i18next'

const denoBackend = {
	type: 'backend' as const,
	init() {},
	read(lng: string, _ns: string, cb: (err: unknown, data?: unknown) => void) {
		Deno.readTextFile(`locale/${lng}.json`).then((t) => cb(null, JSON.parse(t))).catch((e) =>
			cb(e)
		)
	},
}

export const languages = Array.from(Deno.readDirSync('locale/')).map((l) => l.name.split('.')[0]) // get file names

export default async function () {
	try {
		await i18next // init i18next
			.use(denoBackend)
			.init({
				preload: languages,
				fallbackLng: 'en', // if a key does not have a value in a lang, use the english value
				interpolation: { escapeValue: false },
				returnEmptyString: true,
				returnObjects: true,
			})

		print('i18next', `${languages.length} languages loaded`, 'blue')
	} catch (e) {
		print('i18next', e, 'red')
	}
	return
}
