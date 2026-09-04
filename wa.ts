// Entry point: wires prototypes/locales, connects the WhatsApp socket, loads commands/events,
// schedules the daily bulletin, and installs process-wide crash guards so transient network
// errors never kill the bot silently (prod showed 13 fatal body-read crashes + multi-hour gaps).
import { scheduleURMenuMsg } from '@plugin/menuScraping.ts'
import { loadCmds, loadEvents } from '@util/handler.ts'
import cache from '@plugin/cache.ts'
import locale from '@util/locale.ts'
import proto from '@util/proto.ts'
import bot from '@plugin/bot.ts'

// Process-wide crash guards: Deno exits by default on uncaught exceptions and
// unhandled rejections. Prod logs prove these are transient (WhatsApp 428/503/408,
// fetch body torn mid-stream, Baileys background iq queries) and must not kill the
// process. The SOCK close handler owns reconnects; only loggedOut exits explicitly.
globalThis.addEventListener('unhandledrejection', (e) => {
	e.preventDefault()
	try {
		const reason = (e as PromiseRejectionEvent).reason as any
		const msg = reason?.message || reason?.output?.payload?.message || String(reason)
		if (typeof globalThis.print === 'function') {
			print('CRASH', `Unhandled rejection kept alive: ${msg}`, 'red')
		} else console.error('Unhandled rejection kept alive:', reason)
	} catch {
		// Never throw from the crash handler itself.
	}
})
globalThis.addEventListener('error', (e) => {
	try {
		;(e as ErrorEvent).preventDefault?.()
	} catch {
		// ignore
	}
	try {
		const err = (e as ErrorEvent).error || (e as ErrorEvent).message
		const msg = (err as any)?.message || String(err)
		// Deno runtime stream errors (e.g. "error reading a body from connection")
		// arrive here without a timestamp; keep alive and let SOCK reconnect own recovery.
		if (typeof globalThis.print === 'function') {
			print('CRASH', `Uncaught kept alive: ${msg}`, 'red')
		} else console.error('Uncaught kept alive:', err)
	} catch {
		// Never throw from the crash handler itself.
	}
})

proto() // load prototypes
locale() // load locales

start().catch((e) => {
	// Startup failures (bad creds, DB down) must still exit so PM2/dev restarts visibly.
	console.error('Fatal startup failure:', e)
	Deno.exit(1)
})
async function start() {
	await bot.connect()
	await loadCmds()
	await cache.resume()
	await loadEvents()

	if (Deno.env.get('GROUPS1')) scheduleURMenuMsg()
}

// Save cache on both SIGINT (Ctrl+C) and SIGTERM (PM2 stop/restart)
const onExit = async () => {
	await cache.save()
	Deno.exit(0)
}
Deno.addSignalListener('SIGINT', onExit)
Deno.addSignalListener('SIGTERM', onExit)
