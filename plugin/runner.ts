import settings from '../settings/settings.json' with { type: 'json' }
import { execSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import express from 'express'
import fs from 'node:fs'

const languages = Object.keys(settings.runner)
const app = express()

app
	.use(express.json({ limit: '50mb' }))
	.get('/languages', (req, res) => {
		res.send(languages)
	})
	.post('/run', async (req, res) => {
		const { lang, code, file } = req.body

		if ((lang && code) || file) return res.send(runCode(lang, code, file))
		res.send('missing data')
	})
	// .post('/remover', async (req, res) => {
	// 	const { img, quality } = req.body

	// 	const blob = await removeBackground(img, {
	// 		output: {
	// 			format: 'image/png',
	// 			quality: quality || 1,
	// 		},
	// 	})
	// 	const url = URL.createObjectURL(blob);

	// 	const path = `settings/temp/${Math.random}.png`
	// 	writeFile(path, url)

	// 	if (blob) return res.send({ blob, url, path })
	// 	res.send('missing data')
	// })
	.listen(settings.runner.port, () => console.log(`ready! Port: ${settings.runner.port}`))

function runCode(lang: 'py', code = '', file: str) {
	const cli: str[] = []
	let data

	try {
		if (file) {
			lang = file.split('.')[1] as 'py'

			data = settings.runner[lang]
		} else {
			data = settings.runner[lang]

			file = `settings/temp/exec.${data.ext}`
			fs.writeFileSync(file, code)
			code = ''
			// don't write code in CLI to prevent issues
		}

		return data.cmd
			.map((c, i) => {
				cli[i] = `${c} ${file} ${code}` // collect CLIs

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
