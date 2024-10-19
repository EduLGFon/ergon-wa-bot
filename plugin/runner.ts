import settings from '../settings/settings.json' with { type: 'json' }
import { execSync } from 'node:child_process'
import express from 'express'
import fs from 'node:fs'

const languages = Object.keys(settings.runner)
// supported programming languages
const app = express()

app
	.use(express.json({ limit: '50mb' })) // content type: json
	.get('/languages', (req, res) => res.send(languages))
	.post('/run', async (req, res) => {
		const { lang, code, file } = req.body

		if ((lang && code) || file) return res.send(runCode(lang, code, file))
		res.send('missing data')
	})
	.listen(
		settings.runner.port,
		() => console.log(`Runner ready on port ${settings.runner.port}!`),
	)

function runCode(lang: 'py', code = '', file: str) {
	const cli: str[] = []
	let data

	try {
		if (file) {
			lang = file.split('.')[1] as 'py' // get file extension

			data = settings.runner[lang] // get language instruction
		} else {
			data = settings.runner[lang]

			file = `settings/temp/exec.${data.ext}` // file path
			fs.writeFileSync(file, code) // write file
			code = ''
			// don't write code in CLI to prevent issues
		}

		return data.cmd
			.map((c, i) => {
				cli[i] = `${c} ${file} ${code}` // save CLIs

				return execSync(cli[i]) // and run them
			})
			.join(' ')
	} catch (e: any) {
		// remove some chars that can conflict with regex chars
		const regex = `(${filterForRegex(cli.join('|'))})`

		return String(e?.message || e)
			.replace(`Command failed: `, '') // clean errors
			.replace(new RegExp(regex, 'gi'), '') // remove cli from error msg
			.replace(new RegExp(filterForRegex(file), 'gi'), 'file') // remove file name

		// i made it bc C++ error logs are strogonoffcaly large
	}
}

function filterForRegex(str: str) {
	// i made this function twice bc this file runs
	// on a separate thread. It communicates with main thread
	// by http
	return str.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')
}
