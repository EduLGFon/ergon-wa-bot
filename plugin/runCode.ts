import defaults from '../conf/defaults.json' with { type: 'json' }
import { execSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'

export default async function runCode(lang: Lang, code = '', file: str = '', template: str = '') {
	const cli: str[] = []
	let data

	try {
		if (file) {
			lang = file.split('.')[1] as Lang // get file extension

			data = defaults.runner[lang] // get language instruction
		} else {
			data = defaults.runner[lang]

			file = `${defaults.runner.tempFolder}exec.${data.ext}` // file path
			if (template in data.templates && template != '') { //check if have some template selected
				code = data.templates[template].replace("//__CODE__//", code)//and replace the placeholder to the code
			}
			await writeFile(file, code) // write file
			code = ''
			// don't write code in CLI to prevent issues
		}
		let output = ''
		for (const i in data.cmd) {
			cli[i] = `${data.cmd[i]} ${file} ${code}` // save CLIs

			output += execSync(cli[i]) + ' ' // and run them
		}
		return output
	} catch (e: any) {

		// remove some chars that can conflict with regex chars
		const regex = `(${cli.join('|').filterForRegex()})`
		return String(e?.message || e)
			.replace(`Command failed: `, '') // clean errors
			.replace(new RegExp(regex, 'gi'), '') // remove cli from error msg
	}
}
