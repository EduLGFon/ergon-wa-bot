// outbox_smoke - end-to-end check for durable overflow replay.
//
// Exercises the real BridgeDB, the outbox worker and the incoming/dispatch
// path with a fake Telegram API (no network). Verifies that a parked text
// message is replayed through the normal coalescing/pacing pipeline and that
// the outbox row is removed only after the send lands.
//
//   deno run -A scripts/outbox_smoke.ts
import { BridgeDB } from '../plugin/bridge/db.ts'
import { RateLimiter } from '../plugin/bridge/rate-limiter.ts'
import { relayCtx, setRelayCtx } from '../plugin/bridge/wa-to-tg/state.ts'
import {
	drainOutbox,
	startOutboxWorker,
	stopOutboxWorker,
} from '../plugin/bridge/wa-to-tg/outbox.ts'
import { flushCoalesced } from '../plugin/bridge/wa-to-tg/coalesce.ts'
import { proto } from 'baileys'

let failures = 0
function check(name: string, cond: boolean): void {
	if (!cond) {
		failures++
		console.error(`FAIL: ${name}`)
	} else console.log(`ok: ${name}`)
}

const dir = await Deno.makeTempDir({ prefix: 'outbox-smoke-' })
const db = new BridgeDB(`${dir}/bridge.db`)
db.init('personal')
const jid = '15551234567@s.whatsapp.net'
db.getOrCreate(jid, 42, 'Test Person', '1:1', 'personal')

const sent: Array<{ chat: string; text: string }> = []
const tg = {
	api: {
		sendMessage: (chat: string, text: string) => {
			sent.push({ chat, text })
			return Promise.resolve({ message_id: sent.length })
		},
	},
}
const limiter = new RateLimiter(0)
setRelayCtx(tg as any, db, limiter, limiter)
relayCtx.groups = { personal: 'personal', business: 'personal', legacy: 'personal' }

const m: proto.IWebMessageInfo = {
	key: { remoteJid: jid, id: 'OUTBOX1', fromMe: false },
	message: { conversation: 'hello from outbox' },
	pushName: 'Test Person',
}
db.enqueueOutbox(proto.WebMessageInfo.encode(m).finish())
check('row parked', db.outboxCount() === 1)

startOutboxWorker()
await drainOutbox()
await flushCoalesced(jid)
stopOutboxWorker()

check('one message sent', sent.length === 1)
check('body preserved', sent[0]?.text.includes('hello from outbox') === true)
check('chat preserved', sent[0]?.chat === 'personal')
check('row consumed after send', db.outboxCount() === 0)

db.close()
Deno.removeSync(dir, { recursive: true })
if (failures > 0) {
	console.error(`${failures} check(s) failed`)
	Deno.exit(1)
}
console.log('all outbox smokes passed')
