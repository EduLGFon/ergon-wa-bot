import translationBackend from 'i18next-fs-backend';
import { readdirSync } from 'fs';
import i18next from 'i18next';

export default async function () {
	try {
		const preload = readdirSync('src/Core/Locales/')
			.map((l) => l.split('.')[0]);

		await i18next // init i18next
			.use(translationBackend)
			.init({
				preload,
				fallbackLng: 'en',
				backend: { loadPath: 'src/Core/Locales/{{lng}}.json' },
				interpolation: { escapeValue: false },
				returnEmptyString: false,
				returnObjects: true,
			})
		console.log('[i18next', `${preload.length} languages loaded.`, 'cyan');
	} catch (e) {
		console.error('[i18next', e);
	}
	return;
}
