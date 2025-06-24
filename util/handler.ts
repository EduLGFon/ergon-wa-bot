import { BaileysEventMap } from 'baileys'
import cache from '../plugin/cache.js'
import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { Cmd } from '../map.js'
import bot from '../wa.js'

export { loadCmds, loadEvents }

async function folderHandler(path: str, handler: Func) {
	path = resolve(path)
	let count = 0

	for (const category of readdirSync(path)) {
		// For each category folder
		for (const file of readdirSync(`${path}/${category}`)) {
			// for each file of each category
			const imported = await import(`file://${path}/${category}/${file}`)

			// call callback function to this file
			handler(file, category, imported.default)
			count++
		}
	}

	print(
		'HANDLER',
		`${count} ${path.includes('event') ? 'events' : 'cmds'} loaded`,
		'yellow',
	)
	return
}

async function loadCmds() {
	await folderHandler(`./build/cmd`, (file: str, _category: str, imported: any) => {
		const cmd: Cmd = new imported()

		cmd.name = file.slice(0, -3) // remove .ts
		// Set cmd
		cache.cmds.set(cmd.name!, cmd)
	})
	return
}

async function loadEvents() {
	await folderHandler(`./build/event`, (file: str, category: str, imported: any) => {
		const event = imported
		const name = `${category}.${file.slice(0, -3)}`
		// folder+file names are the same of lib events
		cache.events.set(name, event)

		// Listen to the event here
		bot.sock.ev.on(name as keyof BaileysEventMap, (...args) => {
			// It allows to modify events in run time
			cache.events.get(name)!(...args, name)
				.catch((e: Error) => print(`EVENT/${name}:`, e, 'red'))
			// eventFunction(...args, name);
		})
	})
	return
}
