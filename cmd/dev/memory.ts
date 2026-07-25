import Cmd from '@class/cmd.ts'
import { type CmdCtx } from '@conf/types/types.d.ts'

export default class extends Cmd {
	constructor() {
		super({
			alias: ['m'],
			access: {
				restrict: true,
			},
		})
	}
	run({ send }: CmdCtx) {
		const mem = process.memoryUsage()

		const memoryUsageMessage = `Memory Usage:
- RSS (Resident Set Size): ${mem.rss.bytes()}
- Heap Total: ${mem.heapTotal.bytes()}
- Heap Used: ${mem.heapUsed.bytes()}
- External: ${mem.external.bytes()}
- Array Buffers: ${mem.arrayBuffers.bytes()}`

		send(memoryUsageMessage)
		return
	}
}
