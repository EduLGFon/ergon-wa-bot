import humanizeDuration, { Unit } from 'humanize-duration'
import { DateTime, Duration } from 'luxon'
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

// Pino Logger
const logger = pino.default({
	level: 'error',
	transport: {
		target: 'pino-pretty',
		options: { ignore: 'pid,hostname' },
	},
})

export { logger, now }

export default () => {
	strPrototypes() // add string prototypes
	numPrototypes() // add number prototypes
	global.print = console.log = print

	return
}

const brightColors = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']
function print(...anyArgs: any) {
	if (!anyArgs[2]) return console.info(...anyArgs)

	const args = [...anyArgs]
	let color = args.pop()
	const memory = process.memoryUsage().rss.bytes().align(5)
	if (brightColors.includes(color)) color += 'Bright'

	console.info(chalk.bold[color as 'red'](
		`[ ${now('TT.SSS')} |${memory}|${args?.shift()?.align(9)}] - ${args?.shift()}`,
		...args,
	))
	return
}

function numPrototypes() {
	/* Number Prototypes */
	Object.defineProperties(Number.prototype, {
		bytes: { // convert bytes to human readable nums
			value: function () {
				const types = ['B', 'KB', 'MB', 'GB']
				let type = 0
				// deno-lint-ignore no-this-alias
				let number = this

				while (number / 1024 >= 1) {
					type++
					number = number / 1024
				}

				return number.toFixed() + types[type]
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
	return
}

function strPrototypes() {
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
				return !this ? '' : '`' + this.replace('`', '').trim() + '`'
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
			// famous left padding
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
							years: unit === 'y' ? quantity : 0,
							months: unit === 'mo' ? quantity : 0, // Convert 'd' to 'days'
							days: unit === 'd' ? quantity : 0, // Convert 'd' to 'days'
							hours: unit === 'h' ? quantity : 0,
							minutes: unit === 'm' ? quantity : 0,
							seconds: unit === 's' ? quantity : 0,
							weeks: unit === 'w' ? quantity : 0,
							quarters: 0,
							milliseconds: 0,
						})
						return duration.as('milliseconds')
					})
					.reduce((prev, crt) => prev + crt)

				return [ms, match]
			},
		},
	})
	return
}
