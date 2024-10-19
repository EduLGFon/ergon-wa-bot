import translationBackend from 'i18next-fs-backend';
import { readdirSync } from 'node:fs';
import i18next from 'i18next';

export const languages = readdirSync('src/Core/Locales/')
			.map((l) => l.split('.')[0]);

export default async function () {
	try {

		await i18next // init i18next
			.use(translationBackend)
			.init({
				preload: languages,
				fallbackLng: 'en',
				backend: { loadPath: 'src/Core/Locales/{{lng}}.json' },
				interpolation: { escapeValue: false },
				returnEmptyString: false,
				returnObjects: true,
			})
		console.log('i18next', `${languages.length} languages loaded.`, 'cyan');
	} catch (e) {
		console.error('i18next', e);
	}
	return;
}
