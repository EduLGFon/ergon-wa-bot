import settings from '../settings/settings.json' with { type: 'json' }
import { execSync } from 'node:child_process'
import fs from 'node:fs'

const languages = Object.keys(settings.runner)

const handler = async (req: Request): Promise<Response> => {
	const route = req.url.split('/').pop() as 'run'

	const routes = {
		languages() {
			return JSON.stringify(languages)
		},
		async run() {
			const { lang, code, file } = await req.json()

			if ((lang && code) || file) return runCode(lang, code, file)
			return 'missing data'
		},
	}
	const func = routes[route]

	if (func) return new Response(await func())

	return new Response('404')
}

Deno.serve({ port: settings.runner.port }, handler)

function runCode(lang: 'py', code: str = '', file: str) {
	const cli: str[] = []
	let data

	console.log('file:', file)

	try {
		if (file) {
			lang = file.split('.')[1] as 'py'

			data = settings.runner[lang]
		} else {
			data = settings.runner[lang!]

			file = `settings/temp/exec.${data.ext}`
			fs.writeFileSync(file, code!)
			code = ''
			// don't write code in CLI to prevent issues
		}

		return data.cmd!
			.map((c, i) => {
				cli[i] = `${c} ${file} ${code}` // collect CLIs

				console.log(cli)

				return execSync(cli[i])
			})
			.join(' ')
	} catch (e: any) {
		const regex = `(${filterForRegex(cli.join('|'))})`

		return String(e?.message || e)
			.replace(`Command failed: `, '') // clean errors
			.replace(new RegExp(regex, 'gi'), '') // remove cli
			.replace(new RegExp(filterForRegex(file), 'gi'), 'file') // remove file name

		// i made it bc C++ error logs are strogonoffcaly large
	}
}

function filterForRegex(str: str) {
	return str.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')
}
