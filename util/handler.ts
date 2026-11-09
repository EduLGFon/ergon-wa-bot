// Handler loader: discovers command and event modules from disk and binds them to the
// live Baileys socket. Each file loads in isolation with a file-attributed skip line: a
// broken command only degrades that command, but any broken event file fails fast after
// the summary line. Events are load-bearing for reconnect/auth/relay, so a silent boot
// without them looks healthy to the supervisor yet cannot reconnect; a restart loop is
// safer and already bounded by the crash keep-alive 3-in-5min guard. Event dispatch is
// guarded so one bad message or a mid-reconnect clear() can never throw synchronously
// and kill the process.
import { type BaileysEventMap } from 'baileys'
import cache from '@plugin/cache.ts'
import bot from '@plugin/bot.ts'
import Cmd from '@class/cmd.ts'

export { loadCmds, loadEvents }

async function folderHandler(path: str, handler: Func) {
	path = Deno.realPathSync(path)
	const kind = path.includes('event') ? 'events' : 'cmds'
	const single = kind === 'events' ? 'event' : 'cmd'
	let count = 0
	let failed = 0

	for (const { name: category } of Deno.readDirSync(path)) {
		// For each category folder, isolated so one bad entry cannot kill boot
		let files: Deno.DirEntry[]
		try {
			files = [...Deno.readDirSync(`${path}/${category}`)]
		} catch (e) {
			failed++
			print(
				'HANDLER',
				`skip ${single} ${category}: ${(e as Error)?.message || e}`,
				'red',
			)
			continue
		}
		for (const { name: file } of files) {
			if (!file.endsWith('.ts')) continue
			// for each file of each category, isolated so one bad file cannot kill boot
			const rel = `${category}/${file}`
			let imported: any
			try {
				imported = await import(`file://${path}/${category}/${file}`)
			} catch (e) {
				failed++
				print(
					'HANDLER',
					`skip ${single} ${rel}: ${
						(e as Error)?.message || e
					} - check network/JSR cache, restart to retry`,
					'red',
				)
				continue
			}
			if (imported?.default === undefined) {
				failed++
				print(
					'HANDLER',
					`skip ${single} ${rel}: no default export`,
					'red',
				)
				continue
			}

			try {
				// call callback function to this file
				handler(file, category, imported.default)
				count++
			} catch (e) {
				failed++
				print(
					'HANDLER',
					`skip ${single} ${rel}: ${(e as Error)?.message || e}`,
					'red',
				)
			}
		}
	}

	const suffix = failed > 0 ? ` (${failed} failed, see HANDLER skip lines)` : ''
	if (kind === 'events' && failed > 0) {
		// Fail closed: a boot without reconnect/auth/relay handlers looks healthy to
		// the supervisor but can never recover, so throw and let PM2 restart and retry
		// (a transient JSR/network outage self-heals on the next attempt).
		print('HANDLER', `${count} ${kind} loaded${suffix}`, 'red')
		throw new Error(`HANDLER: ${failed} event file(s) failed, failing fast`)
	}
	print('HANDLER', `${count} ${kind} loaded${suffix}`, failed > 0 ? 'red' : 'yellow')
	return
}

async function loadCmds() {
	cache.cmds.clear()
	await folderHandler(`./cmd`, (file: str, _category: str, imported: any) => {
		const cmd: Cmd = new imported()

		cmd.name = file.slice(0, -3) // remove .ts
		// Set cmd
		cache.cmds.set(cmd.name!, cmd)
	})
}

async function loadEvents() {
	cache.events.clear()

	await folderHandler(`./event`, (file: str, category: str, event: any) => {
		const name = `${category}.${file.slice(0, -3)}` as keyof BaileysEventMap
		// folder+file names are the same of lib events
		cache.events.set(name, event)

		bot.sock.ev.removeAllListeners(name)
		// Listen to the event here
		bot.sock.ev.on(name, (...args) => {
			// It allows to modify events in run time
			try {
				const fn = cache.events.get(name)
				if (!fn) return
				// it's the same as eventFunction(...args, name)
				Promise.resolve(fn(...args, name)).catch((e: Error) =>
					print(`EVENT/${name}:`, e, e.stack, 'red')
				)
			} catch (e) {
				// Sync throw (e.g. handler cleared mid-reconnect) must not become uncaught.
				print(`EVENT/${name}:`, e, (e as Error)?.stack, 'red')
			}
		})
	})
}
