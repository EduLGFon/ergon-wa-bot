import config from '../JSON/config.json' assert { type: 'json' };
import { DateTime } from 'luxon';
import dotenv from 'dotenv';
import chalk from 'chalk';

// Setup environment variables
dotenv.config();

// get the now date time formatted
const now = () =>
	DateTime.now()
		.setZone(config.TIMEZONE)
		.setLocale(config.LANG)
		.toFormat('T');

export { now };

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
		filterForRegex: {
			value: function () {
				return this.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
			},
		},
		align: {
			value: function (limit: number, position: 'start' | 'end' = 'start') {
				const ratio = (limit - this.length) / 2;
				const start = ' '.repeat(Math.ceil(ratio));
				const end = ' '.repeat(Math.floor(ratio));

				if (position === 'start') return (start + this + end).slice(0, limit);
				else return (end + this + start).slice(0, limit);
			},
		},
	});

	/* Number Prototypes */

	Object.defineProperties(Number.prototype, {
		bytes: {
			value: function (onlyNumbers?: bool) {
				const types = ['B', 'KB', 'MB', 'GB'];
				let type = 0;
				let number = this;

				while (number / 1024 >= 1) {
					type++;
					number = number / 1024;
				}

				number = number.toFixed(1);

				if (number.slice(-2) === '.0') number = number.slice(0, -2);

				return onlyNumbers ? Number(number) : number + types[type];
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

		const str = `[${title.align(12)}| ${now()} | ${
			(process.memoryUsage().rss.bytes() as str).align(10, 'end')
		}] - ${msg}`;

		// console.log(str);
		console.info(chalk.bold[color as 'red'](str));
		// it prints: [ TITLE | 18:04 | 69MB ] - msg (colored)
		return;
	};

	console.log('PROTOTYPES', 'All set.', 'yellowBright');
	return;
};
