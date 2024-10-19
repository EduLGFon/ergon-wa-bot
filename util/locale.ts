import translationBackend from 'i18next-fs-backend'
import { readdirSync } from 'node:fs'
import i18next from 'i18next'

export const languages = readdirSync('locale/')
	.map((l) => l.split('.')[0])

export default async function () {
	try {
		await i18next // init i18next
			.use(translationBackend)
			.init({
				preload: languages,
				fallbackLng: 'en',
				backend: { loadPath: 'locale/{{lng}}.json' },
				interpolation: { escapeValue: false },
				returnEmptyString: false,
				returnObjects: true,
			})
		print('i18next', `${languages.length} languages loaded.`, 'blue')
	} catch (e) {
		console.error('i18next', e)
	}
	return
}
