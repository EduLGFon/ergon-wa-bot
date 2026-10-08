// Dev-only memory report - shows Deno.memoryUsage plus bridge pressure.
// Needed to track RAM leaks and runtime health without SSH log parsing.
import { groupNameCache, relayCtx } from '@plugin/bridge.ts'
import { type CmdCtx } from '@conf/types/types.d.ts'
import cache from '@plugin/cache.ts'
import Cmd from '@class/cmd.ts'

export default class extends Cmd {
	constructor() {
		super({
			alias: ['m'],
			access: {
				restrict: true,
			},
		})
	}
	// deno-lint-ignore require-await
	async run({ send, args }: CmdCtx) {
		// `.memory gc` triggers a manual collection when --expose-gc is on
		// (prod enables it) so owners can test whether growth is leak or bloat.
		if (args[0] === 'gc') {
			try {
				;(globalThis as any).gc?.()
				send('GC triggered')
			} catch (e) {
				send(`GC failed: ${(e as Error)?.message || e}`)
			}
			return
		}
		const mem = Deno.memoryUsage()
		let queue = 'bridge off'
		try {
			// Personal and business lanes have independent budgets - show
			// both so a business backlog is never mistaken for relay lag.
			const fmtLane = (st: {
				depth: number
				parked: number
				dropped: number
				floodRetries: number
				spacing: number
			}): string =>
				`depth=${st.depth} parked=${st.parked} dropped=${st.dropped} flood=${st.floodRetries} spacing=${st.spacing}ms`
			const personal = relayCtx?.limiter?.stats?.()
			const shared = relayCtx?.businessLimiter === relayCtx?.limiter ||
				!relayCtx?.businessLimiter
			const business = shared ? null : relayCtx?.businessLimiter?.stats?.()
			if (personal) {
				queue = `personal(${fmtLane(personal)})`
				if (business) queue += ` business(${fmtLane(business)})`
			}
		} catch {
			// ignore
		}
		let groups = 0
		let users = 0
		let media = 0
		try {
			groups = cache.groups.size
			users = cache.users.size
			media = cache.media.size
		} catch {
			// ignore
		}

		const memoryUsageMessage = `Memory Usage:
- RSS: ${mem.rss.bytes()}
- Heap Total: ${mem.heapTotal.bytes()}
- Heap Used: ${mem.heapUsed.bytes()}
- External: ${mem.external.bytes()}
- Queue: ${queue}
- Caches: groups=${groups} users=${users} media=${media} names=${groupNameCache.size}
- Tip: .memory gc to force collection (tests leak vs bloat)`

		send(memoryUsageMessage)
	}
}
