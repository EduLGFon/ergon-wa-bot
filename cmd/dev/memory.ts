import { Cmd, type CmdCtx } from '../../map.ts'

export default class extends Cmd {
	constructor() {
		super({
			alias: ['m'],
			access: {
				restrict: true,
			},
		})
	}
	async run({ send }: CmdCtx) {
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
