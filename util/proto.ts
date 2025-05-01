import humanizeDuration, { Unit } from 'humanize-duration'
import { now } from 'util/functions.ts'
import { Buffer } from 'node:buffer'

export { decode, run }
export default function () {
	strPrototypes() // create string prototypes
	numPrototypes() // create number prototypes

	console.log = print // set custom console.log
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
		toBuffer: { // convert string to buffer
			value: function () {
				return Buffer.from(this, 'base64')
			},
		},
		toBlob: { // convert string to blob
			value: function () {
				const buffer = this.toBuffer()
				return new Blob([buffer], { type: 'application/octet-stream' })
				// convert to Uint8Array
				// const byteCharacters = atob(this)
				// const byteNumbers = new Uint8Array(byteCharacters.length)

				// for (let i = 0; i < byteCharacters.length; i++) {
				// 	byteNumbers[i] = byteCharacters.charCodeAt(i)
				// }

				// return new Blob([byteNumbers.buffer], { type: 'application/octet-stream' })
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

async function run(cmd: str, time?: num, callBack?: Func, args?: any[]) {
	const splited = cmd.split(' ')
	const proc = new Deno.Command(splited[0], {
		args: splited.slice(1),
		stdout: 'piped', // catch output
		stderr: 'piped', // catch error
	})

	const cp = proc.spawn()
	let text = ''
	let interval

	if (callBack) interval = setInterval(async () => await callBack(...args!, text), time || 500)

	for await (const line of cp.stdout) text += decode(line)
	for await (const line of cp.stderr) text += decode(line)

	if (callBack) clearInterval(interval)
	return text
}

function decode(stream: Uint8Array<ArrayBuffer>) {
	return new TextDecoder().decode(stream)
}
