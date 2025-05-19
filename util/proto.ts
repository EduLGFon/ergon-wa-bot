import humanizeDuration, { Unit } from 'humanize-duration'
import { now } from 'util/functions.ts'
import { Buffer } from 'node:buffer'
import { Duration } from 'luxon'

export { decode, run }
export default function () {
	strPrototypes() // create string prototypes
	numPrototypes() // create number prototypes

	console.log = print // set custom console.log
}

function strPrototypes() {
	Object.defineProperties(String.prototype, {
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
		toBlob: { // convert string to blob
			value: function () {
				const buffer = Buffer.from(this, 'base64')
				return new Blob([buffer], { type: 'application/octet-stream' })
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
}

function numPrototypes() {
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
}

function print(...anyArgs: any) {
	if (!anyArgs[2]) return console.info(...anyArgs)

	const args = [...anyArgs]
	const color = args.pop()
	const memory = Deno.memoryUsage().rss.bytes().align(5)

	console.info(
		`%c[ ${now('TT.SSS')} |${memory}|${args.shift().align(9)}] - ${args.shift()}`,
		...args,
		`color: ${color}`,
	)
}

// run a cmd on shell
async function run(args: str[], time?: num, callBack?: Func, cbArgs?: any[]) {
	const proc = new Deno.Command(args[0], {
		args: args.slice(1),
		stdout: 'piped', // catch output
		stderr: 'piped', // catch error
	})

	const cp = proc.spawn()
	let text = ''
	let interval

	if (callBack) interval = setInterval(async () => await callBack(...cbArgs!, text), time || 500)

	for await (const line of cp.stdout) text += decode(line)
	for await (const line of cp.stderr) text += decode(line)

	if (callBack) clearInterval(interval)
	return text
}

function decode(stream: Uint8Array<ArrayBuffer>) {
	return new TextDecoder().decode(stream)
}
