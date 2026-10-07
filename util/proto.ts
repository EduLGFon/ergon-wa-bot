// proto - global prototypes, print logger and time helpers
// - adds string and number extensions plus now and humanize
import defaults from '@conf/defaults.json' with { type: 'json' }
import { getFixedT } from 'i18next'

type ShortUnit = 'y' | 'mo' | 'w' | 'd' | 'h' | 'm' | 's' | 'ms'

// Tiny short-duration formatter, replaces npm humanize-duration.
// Keeps largest 2 units with short suffixes like 1h 5m.
function shortDuration(msValue: number, units: ShortUnit[]): string {
	const table: [ShortUnit, number][] = [
		['y', 365 * 24 * 3600_000],
		['mo', 30 * 24 * 3600_000],
		['w', 7 * 24 * 3600_000],
		['d', 24 * 3600_000],
		['h', 3600_000],
		['m', 60_000],
		['s', 1000],
		['ms', 1],
	]
	let rest = Math.max(0, Math.round(msValue))
	const parts: string[] = []
	for (const [u, size] of table) {
		if (!units.includes(u) || rest < size) continue
		const n = Math.floor(rest / size)
		if (n > 0) {
			parts.push(`${n}${u}`)
			rest -= n * size
		}
		if (parts.length >= 2) break
	}
	return parts.join(' ') || `0${units[units.length - 1] ?? 's'}`
}

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

export { logger, memStats, now }

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

// libsignal logs "Session error:Error: Bad MAC" via console.error on every
// undecryptable message (1,569x in 24d of prod logs). Dedupe to 1/hour so
// real session corruption stays visible without burying the log. Counts are
// exposed for HEALTH lines via globalThis.__signalErrorCounts.
const signalErrorCounts = { badMac: 0, decryptFail: 0, closedSession: 0 }
try {
	;(globalThis as any).__signalErrorCounts = signalErrorCounts
} catch {
	// ignore
}
let lastBadMacLog = 0
const origError = console.error.bind(console)
console.error = (...args) => {
	try {
		const first = typeof args[0] === 'string' ? args[0] : ''
		const second = typeof args[1] === 'string' ? args[1] : ''
		const blob = `${first} ${second}`.slice(0, 300)
		const isBadMac = blob.includes('Bad MAC') || blob.includes('Session error')
		const isDecryptFail = blob.includes('Failed to decrypt message with any known session')
		if (isBadMac) signalErrorCounts.badMac++
		if (isDecryptFail) signalErrorCounts.decryptFail++
		if (isBadMac || isDecryptFail) {
			const nowMs = Date.now()
			if (nowMs - lastBadMacLog < 3_600_000) return
			lastBadMacLog = nowMs
			return origError(
				`[libsignal] session errors throttled (1/h, badMac=${signalErrorCounts.badMac} decryptFail=${signalErrorCounts.decryptFail})`,
				...args.slice(0, 2),
			)
		}
	} catch {
		// fall through to normal error
	}
	return origError(...args)
}

// "Decrypted message with closed session" arrives via console.log from
// libsignal - count it for HEALTH without spamming (74x in 24d).
const origLog = console.log.bind(console)
let lastClosedSessionLog = 0
// Note: print() calls console.log internally, so only intercept the raw
// libsignal line to avoid recursion.
console.log = (...args) => {
	try {
		const first = typeof args[0] === 'string' ? args[0] : ''
		if (first.includes('Decrypted message with closed session')) {
			signalErrorCounts.closedSession++
			const nowMs = Date.now()
			if (nowMs - lastClosedSessionLog < 3_600_000) return
			lastClosedSessionLog = nowMs
		}
		// "Closing open session in favor of incoming prekey bundle" is routine
		// re-keying (21x) - count but only log hourly like the rest.
		if (first.includes('Closing open session')) {
			const nowMs = Date.now()
			if (nowMs - lastClosedSessionLog < 3_600_000) return
			lastClosedSessionLog = nowMs
		}
	} catch {
		// fall through
	}
	return origLog(...args)
}

const colorize = (color: string, ...args: any) => {
	const text = args.map((a: any) => typeof a === 'string' ? a : Deno.inspect(a)).join(' ')
	return [`%c${text}`, `color: ${color}; font-weight: bold;`]
}
// Loop-lag tracker for health logs: measures event-loop delay via a
// zero-timeout probe. Updated in the background, read synchronously by
// print() so every log line carries RSS + heap + lag without extra cost.
let lastLoopLagMs = 0
if (!(globalThis as any).__loopLagStarted) {
	;(globalThis as any).__loopLagStarted = true
	const probeLoopLag = () => {
		const t0 = performance.now()
		setTimeout(() => {
			try {
				lastLoopLagMs = Math.max(0, Math.round(performance.now() - t0))
			} catch {
				// ignore probe errors
			}
			setTimeout(probeLoopLag, 30_000).unref?.()
		}, 0)
	}
	try {
		setTimeout(probeLoopLag, 30_000).unref?.()
	} catch {
		// timers unavailable in some contexts - lag stays 0
	}
}

// Snapshot for HEALTH lines and the memory command: RSS + heap + lag.
function memStats(): { rss: string; heap: string; lag: number } {
	try {
		const m = Deno.memoryUsage()
		return {
			rss: (m.rss as number).bytes(),
			heap: (m.heapUsed as number).bytes(),
			lag: lastLoopLagMs,
		}
	} catch {
		return { rss: '?', heap: '?', lag: lastLoopLagMs }
	}
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
	const m = Deno.memoryUsage()
	const memory = (m.rss as number).bytes().align(5)
	const heap = (m.heapUsed as number).bytes()
	const lag = lastLoopLagMs > 0 ? ` l:${lastLoopLagMs}ms` : ''

	console.log(
		...colorize(
			color,
			`[ ${now()} |${memory} h:${heap}${lag}|${args?.shift()?.align(11)}] -`,
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
				const units: ShortUnit[] = ['y', 'd', 'h', 'm', 's']
				if (ms) units.push('ms')

				return shortDuration(Number(this), units)
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
