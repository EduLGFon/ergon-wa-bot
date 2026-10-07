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
//
// Bound: 3+ crashes in 5min or RSS over 2GB exits non-zero so PM2 restarts
// cleanly instead of limping at 5GB (15/09 prod spike kept alive at 4.9GB).
const crashTimes: number[] = []
function recordCrash(kind: string, msg: string): void {
	const nowMs = Date.now()
	crashTimes.push(nowMs)
	while (crashTimes.length && crashTimes[0] < nowMs - 5 * 60_000) crashTimes.shift()
	if (typeof globalThis.print === 'function') {
		print('CRASH', `${kind} kept alive: ${msg} (${crashTimes.length}/3 in 5min)`, 'red')
	} else console.error(`${kind} kept alive:`, msg)
	try {
		const rss = (Deno.memoryUsage().rss as number) ?? 0
		if (rss > 2 * 1024 * 1024 * 1024) {
			console.error(
				`[CRASH] RSS ${(rss / 1024 ** 3).toFixed(2)}GB over 2GB, exiting for PM2 restart`,
			)
			setTimeout(() => Deno.exit(1), 500).unref?.()
			return
		}
	} catch {
		// memory read failed - ignore
	}
	if (crashTimes.length >= 3) {
		console.error('[CRASH] 3 crashes in 5min, exiting for PM2 backoff restart')
		setTimeout(() => Deno.exit(1), 500).unref?.()
	}
}
globalThis.addEventListener('unhandledrejection', (e) => {
	e.preventDefault()
	try {
		const reason = (e as PromiseRejectionEvent).reason as any
		const msg = reason?.message || reason?.output?.payload?.message || String(reason)
		recordCrash('Unhandled rejection', msg)
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
		recordCrash('Uncaught', msg)
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

	// Deaf-session watchdog: attaches after loadEvents (which resets listeners) and
	// re-attaches from the reconnect path whenever the socket is recreated.
	try {
		const { attachHealthWatchdog } = await import('@plugin/health.ts')
		attachHealthWatchdog()
	} catch (e) {
		print('HEALTH', `watchdog disabled: ${(e as Error)?.message || e}`, 'yellow')
	}

	// Telegram bridge shares this process's WhatsApp socket (no 2nd connection).
	// Must start AFTER loadEvents(), which resets event listeners.
	try {
		const { startBridge } = await import('./bridge/mod.ts')
		await startBridge()
	} catch (e) {
		print('BRIDGE', `disabled: ${(e as Error)?.message || e}`, 'red')
	}

	if (Deno.env.get('GROUPS1')) scheduleURMenuMsg()
}

// Save cache on both SIGINT (Ctrl+C) and SIGTERM (PM2 stop/restart)
const onExit = async () => {
	await cache.save()
	try {
		const { shutdownStickers } = await import('@plugin/sticker/index.ts')
		await shutdownStickers()
	} catch {
		// sticker pool may not have started; ignore shutdown errors
	}
	Deno.exit(0)
}
Deno.addSignalListener('SIGINT', onExit)
Deno.addSignalListener('SIGTERM', onExit)
