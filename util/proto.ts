import defaults from '@conf/defaults.json' with { type: 'json' }
import humanizeDuration, { type Unit } from 'humanize-duration'
import { getFixedT } from 'i18next'

// get 'now' date time formatted
const now = () => {
	const d = new Date()
	try {
		return new Intl.DateTimeFormat(defaults.lang, {
			timeZone: Deno.env.get('TZ'),
			day: '2-digit',
			month: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			fractionalSecondDigits: 3,
			hour12: false,
		}).format(d).replace(',', '')
	} catch {
		return d.toISOString()
	}
}

// Dummy Logger for Baileys
const logger: any = {
	level: 'silent',
	child: () => logger,
	trace: () => {},
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
	fatal: () => {},
}

export { logger, now }

export default () => {
	strPrototypes() // add string prototypes
	numPrototypes() // add number prototypes
	global.print = print
	console.info = print
	if (Deno.env.get('DEV')) print('DEV', 'Development mode enabled', 'blue')
	print('PROTO', 'setted', 'yellow')
}

function isSessionEntryLike(value: any) {
	return (
		!!value &&
		typeof value === 'object' &&
		(value.constructor?.name === 'SessionEntry' ||
			'indexInfo' in value ||
			'currentRatchet' in value ||
			'pendingPreKey' in value)
	)
}

const warn = console.warn.bind(console)
console.warn = (...args) => {
	if (
		typeof args[0] === 'string' &&
		args[0].includes('Session already closed') &&
		args.slice(1).some(isSessionEntryLike)
	) {
		return
	}
	return warn(...args)
}

const colorize = (color: string, ...args: any) => {
	const text = args.map((a: any) => typeof a === 'string' ? a : Deno.inspect(a)).join(' ')
	return [`%c${text}`, `color: ${color}; font-weight: bold;`]
}
function print(...args: any) {
	if (
		typeof args[0] === 'string' &&
		(args[0].includes('Closing session') || args[0].includes('Removing old closed session')) &&
		args.slice(1).some(isSessionEntryLike)
	) {
		return
	}
	if (typeof args[2] !== 'string') return console.log(...args)

	const color = args.pop()
	const memory = Deno.memoryUsage().rss.bytes().align(5)

	console.log(
		...colorize(
			color,
			`[ ${now()} |${memory}|${args?.shift()?.align(11)}] -`,
			...args,
		),
	)
}

function numPrototypes() {
	/* Number Prototypes */
	Object.defineProperties(Number.prototype, {
		bytes: {
			// convert bytes to human readable nums
			configurable: true,
			value: function () {
				const types = ['B', 'KB', 'MB', 'GB']
				let type = 0
				// deno-lint-ignore no-this-alias
				let number = this

				while (number / 1024 >= 1) {
					type++
					number = number / 1024
				}

				return number.toFixed(3) + types[type]
			},
		},
		duration: {
			// convert ms time in short duration str
			configurable: true,
			value: function (ms?: bool) {
				// 1000 => 1s
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
}

function strPrototypes() {
	/* String Prototypes */
	Object.defineProperties(String.prototype, {
		// get a URL on a string
		getUrl: {
			configurable: true,
			value: function () {
				const regex =
					/https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/gi
				return this.match(regex)
			},
		},
		//      'deno'.toPascalCase() === 'Deno'
		toPascalCase: {
			configurable: true,
			value: function () {
				return this.slice(0, 1).toUpperCase() + this.slice(1).toLowerCase()
			},
		},
		encode: {
			// encode strings
			configurable: true,
			value: function () {
				return !this ? '' : '`' + this.replace(/`/g, '').trim() + '`'
			},
		},
		parsePhone: {
			// parse wpp id to phone number
			configurable: true,
			value: function () {
				return this.split('@')[0].split(':')[0]
			},
		},
		bold: {
			// make text bold
			configurable: true,
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
		filterForRegex: {
			// remove some chars that conflict with regex chars
			configurable: true,
			value: function () {
				return this.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')
			},
		},
		t: {
			// get locale
			configurable: true,
			value: function (lang: str, options = {}) {
				// 'help.menu'.t('en') => 'help menu'
				return getFixedT(lang)(this, options)
			},
		},
		align: {
			// align a word between spaces
			configurable: true,
			// famous left padding
			value: function (limit: num, char: str = ' ', endPosition?: bool) {
				let ratio = (limit - this.length) / 2
				if (ratio < 1) ratio = 1

				const start = char.repeat(Math.ceil(ratio))
				const end = char.repeat(Math.floor(ratio))

				if (endPosition) return end + this + start
				else return start + this + end
			},
		},
		toMs: {
			// convert a str on ms
			configurable: true,
			value: function () {
				// '10s' => 1_000 * 10
				const match: str[] = this.match(/(\d+)(y|d|h|m|s|w)/gi) || []

				if (!match[0]) return [0]

				const multipliers: Record<string, number> = {
					s: 1000,
					m: 60 * 1000,
					h: 60 * 60 * 1000,
					d: 24 * 60 * 60 * 1000,
					w: 7 * 24 * 60 * 60 * 1000,
					mo: 30 * 24 * 60 * 60 * 1000,
					y: 365 * 24 * 60 * 60 * 1000,
				}

				const ms = match
					.map((m) => {
						const quantity = parseInt(m, 10)
						const unit = m.replace(String(quantity), '')
						return quantity * (multipliers[unit] || 0)
					})
					.reduce((prev, crt) => prev + crt)

				return [ms, match]
			},
		},
	})
}
