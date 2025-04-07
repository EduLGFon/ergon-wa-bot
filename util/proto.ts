import humanizeDuration, { Unit } from 'humanize-duration'
import defaults from 'defaults' with { type: 'json' }
import { DateTime } from 'luxon'

export { decode, now, run }
export default function () {
	strPrototypes() // create string prototypes
	numPrototypes() // create number prototypes

	console.log = print // set custom console.log
}

// get 'now' date time formatted
function now(format = 'TT') {
	return DateTime.now()
		.setZone(defaults.timezone)
		.setLocale(defaults.lang)
		.toFormat(format) // TT = HOURS:MINITES:SECONDS
}

function strPrototypes() {
	Object.defineProperties(String.prototype, {
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

function print(...args: any) {
	if (!args[2]) return console.info(...args)

	const [title, msg, color] = [...args]
	const memory = Deno.memoryUsage().rss.bytes().align(5)

	console.info(
		`%c[ ${now('TT.SSS')} |${memory}|${title.align(9)}] - ${msg}`,
		`color: ${color}`,
	)
}

async function run(cmd: str, callBack?: Func, time?: num) {
	const splited = cmd.split(' ')
	const proc = new Deno.Command(splited[0], {
		args: splited.slice(1),
		stdout: 'piped', // catch output
		stderr: 'piped', // catch error
	})

	const cp = proc.spawn()
	let text = 'Spawning cp...\n'
	let interval

	if (callBack) interval = setInterval(() => callBack(text), time || 500)

	for await (const line of cp.stdout) text += decode(line)
	for await (const line of cp.stderr) text += decode(line)

	if (callBack) clearInterval(interval)
	return text
}

function decode(stream: Uint8Array<ArrayBuffer>) {
	return new TextDecoder().decode(stream)
}
