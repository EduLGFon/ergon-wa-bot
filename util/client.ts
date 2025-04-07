import { Client } from 'wa'
import cache from 'cache'

export async function folderHandler(path: str, handler: Func, bind: any) {
	// iterates through a folder and loads all files
	let count = 0

	for await (const folder of Deno.readDir(path)) {
		const file = await import(`${path}/${folder.name}`)
		const event = folder.name.split('.')[0]

		handler.bind(bind)(event, file.default, bind)
		count++
	}

	console.log(
		'HANDLER',
		`${count} ${path.includes('event') ? 'events' : 'cmds'} loaded`,
		'yellow',
	)
	return
}

export function loadEvent(event: str, func: Func, bot: Client) {
	bot.on(event, (...args) => func(bot, ...args))
	return
}

export function loadCmd(cmd: str, func: any, _bot: Client) {
	cache.cmds.add(cmd, new func())
	return
}
