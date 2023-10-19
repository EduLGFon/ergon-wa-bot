import config from '../JSON/config.json' assert { type: 'json' };
import { DateTime } from 'luxon';
//@ts-ignore chalk is now pure ESM and Node is CommonJS
import chalk from 'chalk';

const now = () =>
	DateTime.now()
		.setZone(config.TIMEZONE)
		.setLocale(config.LANG)
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
		align: {
			value: function (limit: number, position: 'start' | 'end' = 'start') {
				const ratio = (limit - this.length) / 2;
				const start = ' '.repeat(Math.ceil(ratio));
				const end = ' '.repeat(Math.floor(ratio));

				if (position === 'start') return (start + this + end).slice(0, limit);
				else return (end + this + start).slice(0, limit)
			},
		},
	});

	/*      console.error        */
	// easier way to print error messages
	console.error = (error: { stack: str }) => {
		const msg = String(error?.stack || error)
			.slice(0, 512);

		console.log('ERROR', msg, 'red');
	};

	/*      console.log        */
	// The same console.log but styled differently
	console.log = (...args) => {
		if (typeof args[0] !== 'string' || !args[2]) {
			console.info(...args);
			return;
		}

		const [title, msg, color] = [...args];

		const str = `[${title.align(12)}| ${now()} | ${(getRAM() as str).align(11, 'end')}] - ${msg}`;

		console.log(str);
		//console.info(chalk.bold[color as 'red'](str));
		// it prints: [ TITLE | 18:04 | 69MB ] - msg (colored)
		return;
	};

	console.log('PROTOTYPES', 'All set.', 'yellowBright');
	return;
};
