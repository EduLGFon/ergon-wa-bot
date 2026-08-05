import defaults from '@conf/defaults.json' with { type: 'json' }
import { db as prisma, getGroup, getUser } from '@db'
import { type CmdCtx } from '@conf/types/types.d.ts'
import { sendURMenu } from '@plugin/menuScraping.ts'
import { randomDelay } from '@util/functions.ts'
import { checkMatch } from '@util/msgTools.ts'
import { delay } from '@util/functions.ts'
import { extname } from 'jsr:@std/path'
import cache from '@plugin/cache.ts'
import bot from '@plugin/bot.ts'

// removed execAsync

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
		if (!file) {
			// it's a dev-introduced code. not a file already created.
			data = defaults.runner[lang] // lang instructions
			if (data.triggers) code = testTriggers(data.triggers, code)
			// when a trigger triggers, a template is pasted in code
			if (lang === 'eval') {
				// it's a this-process JS code
				// i'll place several variables and functions here
				// bc i may want to use them on eval
				// deno-lint-ignore no-unused-vars
				const { msg, args, user, group, send, react } = ctx!
				randomDelay
				getGroup
				checkMatch
				getUser
				prisma
				delay
				cache
				sendURMenu
				bot
				return Deno.inspect(await eval(code))
			}
			// it's not a this-process JS code
			// so let's create a file and run it with the right runtime
			file = `${defaults.runner.tempFolder}/exec.${data.ext!}` // temp/exec.rs

			await Deno.writeTextFile(file, code) // write file
			code = '' // clean the code bc it will be on CLI if (file)
		} else {
			// it's a already created file
			lang = extname(file).slice(1) as Lang // get file extension (e.g. '.rs' => 'rs')
			data = defaults.runner[lang] // get language instruction
		}

		let output = ''
		for (const i in data.cmd) {
			// cmd is a shell cmd script to run the code
			// you didn't see the cli? it's here => cli: str[] = []
			const [runner, ...args] = `${data.cmd[i]} ${file} ${code}`.split(' ')
			cli[i] = `${data.cmd[i]} ${file} ${code}`
			// place every cmd into the cli list

			const cmdObj = new Deno.Command(runner, { args })
			const res = await cmdObj.output()
			output += new TextDecoder().decode(res.stdout) + new TextDecoder().decode(res.stderr)
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

function testTriggers(triggers: trigger[], code: str) {
	for (let t of triggers) {
		if (Object.hasOwn(t, 'includes')) {
			// it's a 'includes' trigger
			t = t as triggerIncludes
			for (const i of t.includes) {
				if (code.includes(i)) {
					code = t.template.replace('{{code}}', code)
					break
				}
			}
		} else if (Object.hasOwn(t, 'notIncludes')) {
			// it's a 'not includes' trigger
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
