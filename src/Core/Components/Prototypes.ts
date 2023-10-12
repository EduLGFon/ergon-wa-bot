import { LANG, TIMEZONE } from '../JSON/config.json';
import { DateTime } from 'luxon';

const now = () =>
	DateTime.now()
		.setZone(TIMEZONE)
		.setLocale(LANG)
		.toFormat('T');

const getRAM = (backAsNumber?: bool) => {
	const ram = (process.memoryUsage().rss / 1024 / 1024).toFixed(2);

	if (backAsNumber) return Number(ram);
	else return ram + 'MB';
};

export { getRAM, now };

export default () => {
	/* String Prototypes */

	Object.defineProperties(String.prototype, {
		//      'deno'.toPascalCase() === 'Deno'
		toPascalCase: {
			value: function () {
				return this.slice(0, 1).toUpperCase() + this.slice(1);
			},
		},
		encode: {
			value: function () {
				return '```\n' + this + '```';
			},
		},
	});

	/*      console.error        */
	// easier way to print error messages
	console.error = (error: { stack: str }) => {
		const msg = String(error?.stack || error)
			.slice(0, 512);

		console.log('[ERROR', msg, 'red');
	};

	/*      console.log        */
	// The same console.log but styled differently
	console.log = (...args) => {
		if (typeof args[0] !== 'string' || !args[2] || !args[0].startsWith('[')) {
			return console.info(...args);
		}

		const [title, msg] = [...args];

		const str = `${title} | ${now()} | ${getRAM()}] - ${msg}`;

		return console.info(str); // [ TITLE | 18:04 | 69MB ] - msg
	};

	console.log('[PROTOTYPES', 'All set.');
};
