import translationBackend from 'i18next-fs-backend'
import { readdirSync } from 'node:fs'
import i18next from 'i18next'

export const languages = readdirSync('locale/')
	.map((l) => l.split('.')[0]) // get file names

export default async function () {
	try {
		await i18next // init i18next
			.use(translationBackend)
			.init({
				preload: languages,
				fallbackLng: 'en', // if a key does not have a value in a lang, use the english value
				backend: { loadPath: 'locale/{{lng}}.json' },
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
