import humanizeDuration, { Unit } from 'humanize-duration'
import { DateTime, Duration } from 'luxon'
import { inspect } from 'node:util'
import { getFixedT } from 'i18next'
import { defaults } from '../map.js'
import chalk from 'chalk'
import pino from 'pino'

// get 'now' date time formatted
const now = (format = 'TT') =>
	DateTime.now()
		.setZone(defaults.timezone)
		.setLocale(defaults.lang)
		.toFormat(format) // TT = HOURS:MINITES:SECONDS

export { now }

export default () => {
	/* String Prototypes */
	Object.defineProperties(String.prototype, {
		// get a URL on a string
		getUrl: {
			value: function () {
				const regex =
					/https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/gi
				return this.match(regex)
			},
		},
		//      'deno'.toPascalCase() === 'Deno'
		toPascalCase: {
			value: function () {
				return this.slice(0, 1).toUpperCase() + this.slice(1)
			},
		},
		encode: { // encode strings
			value: function () {
				return '```\n' + this + '```'
			},
		},
		parsePhone: { // parse wpp id to phone number
			value: function () {
				return this.split('@')[0].split(':')[0]
			},
		},
		bold: { // make text bold
			value: function (this: str) {
				const chars = this.split('')
				let result = ''

				for (let i = 0; i < chars.length; i++) {
					if (chars[i] === ' ') {
						if (chars[i - 1] !== ' ' && i > 0) result += '*'
						result += ' '
						continue
					} else if (chars[i - 1] === ' ') result += '*'
					result += chars[i]
				}

				return result
			},
		},
		filterForRegex: { // remove some chars that conflict with regex chars
			value: function () {
				return this.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')
			},
		},
		t: { // get locale
			value: function (lang: str, options = {}) {
				// 'help.menu'.t('en') => 'help menu'
				return getFixedT(lang)(this, options)
			},
		},
		align: { // align a word between spaces
			value: function (limit: num, char: str = ' ', endPosition?: bool) {
				let ratio = (limit - this.length) / 2
				if (ratio < 1) ratio = 1

				const start = char.repeat(Math.ceil(ratio))
				const end = char.repeat(Math.floor(ratio))

				if (endPosition) return (end + this + start)
				else return (start + this + end)
			},
		},
		toMs: { // convert a str on ms
			value: function () { // '10s' => 1_000 * 10
				const match: str[] = this.match(/(\d+)(y|d|h|m|s|w)/gi) || []

				if (!match[0]) return [0]

				const ms = match
					.map((m) => {
						const quantity = parseInt(m, 10)
						const unit = m.replace(String(quantity), '')

						const duration = Duration.fromObject({
							years: unit === 'y' ? quantity : undefined,
							days: unit === 'd' ? quantity : undefined, // Convert 'd' to 'days'
							hours: unit === 'h' ? quantity : undefined,
							minutes: unit === 'm' ? quantity : undefined,
							seconds: unit === 's' ? quantity : undefined,
							weeks: unit === 'w' ? quantity : undefined,
						})
						return duration.as('milliseconds')
					})
					.reduce((prev, crt) => prev + crt)

				return [ms, match]
			},
		},
	})

	/* Number Prototypes */
	Object.defineProperties(Number.prototype, {
		bytes: { // convert bytes to human readable nums
			value: function (onlyNumbers?: bool) {
				const types = ['B', 'KB', 'MB', 'GB']
				let type = 0
				let number = this

				while (number / 1024 >= 1) {
					type++
					number = number / 1024
				}

				number = number.toFixed()

				// if (number.slice(-2) === '.0') number = number.slice(0, -2);

				return onlyNumbers ? Number(number) : number + types[type]
			},
		},
		duration: { // convert ms time in short duration str
			value: function (ms?: bool) { // 1000 => 1s
				const units: Unit[] = ['y', 'd', 'h', 'm', 's']
				if (ms) units.push('ms')

				return humanizeDuration.humanizer({
					language: 'short',
					delimiter: ' ',
					round: true,
					spacer: '',
					largest: 2,
					units,
					languages: {
						short: {
							y: () => 'y',
							mo: () => 'mo',
							w: () => 'w',
							d: () => 'd',
							h: () => 'h',
							m: () => 'm',
							s: () => 's',
							ms: () => 'ms',
						},
					},
				})(this)
			},
		},
	})

	/** Console.error:
	 * It's a error control function
	 * Only error msgs appears on logs/terminal
	 * and its stack appears on a specific error file
	 * That control is handled by pm2. I only
	 * choose console.error or console.log
	 */
	const printError = console.error // error old function
	console.error = (error: { stack: str; message: str }, title = 'ERROR') => {
		const msg = error?.message || error
		console.log(title, msg, 'red') // error msg goes to output file

		const stack = String(error?.stack || error)
		printError(fmtLog(title, stack, 'red')) // error stack goes to error file
		return
	}

	/** Print = Console.log
	 * Just a print function, but styled. Like you.
	 */
	global.print = console.log = (...args) => { // print() === console.log()
		if (typeof args[0] !== 'string' || !args[2]) {
			if (typeof args[0] === 'object') return console.info(inspect(args[0], { depth: null }))

			console.info(...args)
			return // Ignore this shitty code.
		}

		let [title, msg, color]: str[] = [...args]
		// Uh but why do I know these arguments will always come this way?
		// I only code this way. Yea, it's not the best way, but it's definitely a way

		const str = fmtLog(title, msg, color)

		console.info(str)
		// it prints: [ 18:04:99.069 | 69MB | TITLE ] - msg (colored)
		return
	}

	// Pino Logger
	const logger = pino.default({
		level: 'error',
		transport: {
			target: 'pino-pretty',
			options: { ignore: 'pid,hostname' },
		},
	})
	return logger
}

function fmtLog(title: str, msg: str, color: str) {
	const brightColors = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']
	const memory = process.memoryUsage().rss.bytes() as str

	if (brightColors.includes(color)) color += 'Bright'

	const str = `[ ${now('TT.SSS')} |${memory.align(5)}|${title.align(9)}] - ${msg}`
	// [ 18:04:99.069 | 69MB | TITLE ] - msg (colored)

	return chalk.bold[color as 'red'](str)
}
