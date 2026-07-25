import { type CmdCtx } from '@conf/types/types.d.ts'
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
	async run({ send }: CmdCtx) {
		const mem = Deno.memoryUsage()

		const memoryUsageMessage = `Memory Usage:
- RSS (Resident Set Size): ${mem.rss.bytes()}
- Heap Total: ${mem.heapTotal.bytes()}
- Heap Used: ${mem.heapUsed.bytes()}
- External: ${mem.external.bytes()}`

		send(memoryUsageMessage)
	}
}
