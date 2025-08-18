import defaults from '../conf/defaults.json' with { type: 'json' }
import prisma, { getGroup, getUser } from './prisma.js'
import { readFile, writeFile } from 'node:fs/promises'
import { randomDelay } from '../util/functions.js'
import { execSync } from 'node:child_process'
import { inspect } from 'node:util'
import { CmdCtx, delay } from '../map.js'
import cache from './cache.js'
import bot from '../wa.js'

type triggerIncludes = { includes: str[]; template: str }
type triggerNotIncludes = { notIncludes: str[]; template: str }
type trigger = triggerIncludes | triggerNotIncludes
interface LangInstructions {
	cmd: str[]
	ext?: str
	triggers?: trigger[]
}

export default async function runCode(lang: Lang, code = '', file = '', ctx?: CmdCtx) {
	let data: LangInstructions
	const cli: str[] = []

	try {
		if (!file) { // it's a dev-introduced code. not a file already created.
			data = defaults.runner[lang] // lang instructions
			if (data.triggers) code = testTriggers(data.triggers, code)
			// when a trigger triggers, a template is pasted in code
			if (lang === 'eval') {
				// it's a this-process JS code
				// i'll place several variables and functions here
				// bc i may want to use them on eval
				const { msg, args, user, group, send, react } = ctx!
				randomDelay
				writeFile
				getGroup
				readFile
				getUser
				prisma
				delay
				cache
				bot
				return inspect(await eval(code))
			}
			// it's not a this-process JS code
			// so let's create a file and run it with the right runtime
			file = `${defaults.runner.tempFolder}exec.${data.ext!}` // temp/exec.rs

			await writeFile(file, code) // write file
			code = '' // clean the code bc it will be on CLI if (file)
		} else { // it's a already created file
			lang = file.split('.')[1] as Lang // get file extension
			data = defaults.runner[lang] // get language instruction
		}

		let output = ''
		for (const i in data.cmd) { // cmd is a shell cmd script to run the code
			// you didn't see the cli? it's here => cli: str[] = []
			cli[i] = `${data.cmd[i]} ${file} ${code}`
			// place every cmd into the cli list

			output += execSync(cli[i]) + ' ' // run the cmd
		}
		return output.trim()
	} catch (e: any) {
		// remove some chars that can conflict with regex chars
		const regex = `(${cli.join('|').filterForRegex()})`
		return String(e?.message || e)
			.replace(`Command failed: `, '') // clean errors
			.replace(new RegExp(regex, 'gi'), '') // remove cli from error msg
	}
}
//    ___
//   (o o)        linksyyy pass here
//   ( V )        'reri' also pass here
///--m - m---------\

function testTriggers(triggers: trigger[], code: str) {
	for (let t of triggers) {
		if (Object.hasOwn(t, 'includes')) {
			t = t as triggerIncludes
			for (const i of t.includes) {
				if (code.includes(i)) {
					code = t.template.replace('{{code}}', code)
					break
				}
			}
		} else if (Object.hasOwn(t, 'notIncludes')) {
			t = t as triggerNotIncludes
			for (const i of t.notIncludes) {
				if (!code.includes(i)) {
					code = t.template.replace('{{code}}', code)
					break
				}
			}
		}
	}
	return code
}
