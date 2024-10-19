import translationBackend from 'i18next-node-fs-backend';
import { readdirSync } from 'fs';
import i18next from 'i18next';

export default function () {
	try {
		const preload = readdirSync('src/Locales/')
			.map((l) => l.split('.')[0]);

		i18next
			.use(translationBackend)
			.init({
				preload,
				fallbackLng: 'en',
				backend: { loadPath: 'src/Locales/{{lng}}.json' },
				interpolation: { escapeValue: false },
				returnEmptyString: false,
				returnObjects: true,
			});
	} catch (e) {
		console.error(e);
	}
}
