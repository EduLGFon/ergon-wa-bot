import translationBackend from 'i18next-node-fs-backend';
import { readdirSync } from 'fs';
import i18next from 'i18next';

export default function () {
	try {
		i18next
			.use(translationBackend)
			.init({
				ns: ['cmd', 'event', 'usage'],
				preload: readdirSync('src/Locales/'),
				fallbackLng: 'en',
				backend: { loadPath: 'src/Locales/{{lng}}/{{ns}}.json' },
				interpolation: { escapeValue: false },
				returnEmptyString: false,
				returnObjects: true,
				defaultNS: 'cmd',
			});
	} catch (e) {
		console.error(e);
	}
}
