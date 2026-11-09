// bridge_bucket_smoke - targeted checks for bucket split-brain healing.
//
// Uses a synthetic temp SQLite DB plus a fake Telegram API (no network, no
// real bridge state). Proves that a LID-only and a PN+alt upsert collapse
// onto one topic, that a business row physically hosted in the personal
// group is reported as needs-move and repointed, that boot reconcile merges
// a duplicate LID/PN pair onto the newest topic, that muted chats stay
// put, and that a single-group setup never stamps an undecided row with a
// bucket it never chose.
//
//   deno run -A scripts/bridge_bucket_smoke.ts
import { needsMove, reconcileSplitBrain } from '../plugin/bridge/tg-to-wa/buckets.ts'
import { relayCtx, setRelayCtx } from '../plugin/bridge/wa-to-tg/state.ts'
import { ensureTopicMapping } from '../plugin/bridge/wa-to-tg/topics.ts'
import { RateLimiter } from '../plugin/bridge/rate-limiter.ts'
import { moveTopic } from '../plugin/bridge/wa-to-tg/move.ts'
import { BridgeDB } from '../plugin/bridge/db.ts'

let failures = 0
function check(name: string, cond: boolean): void {
	if (!cond) {
		failures++
		console.error(`FAIL: ${name}`)
	} else console.log(`ok: ${name}`)
}

const dir = await Deno.makeTempDir({ prefix: 'bucket-smoke-' })
const db = new BridgeDB(`${dir}/bridge.db`)
db.init('personal')

const groups = { personal: '-1001', business: '-1002', legacy: '-1001' }
let nextTopic = 100
let created = 0
let nextMsg = 500
const tg = {
	api: {
		createForumTopic: (_chatId: string, _name: string) => {
			created++
			return Promise.resolve({ message_thread_id: ++nextTopic })
		},
		sendMessage: (_chatId: string, _text: string, _opts?: unknown) => {
			return Promise.resolve({ message_id: ++nextMsg })
		},
		editForumTopic: (_chatId: string, _topicId: number, _opts?: unknown) => {
			return Promise.resolve(true)
		},
		deleteMessage: (_chatId: string, _msgId: number) => Promise.resolve(true),
		deleteForumTopic: (_chatId: string, _topicId: number) => Promise.resolve(true),
		pinChatMessage: (_chatId: string, _msgId: number, _opts?: unknown) => Promise.resolve(true),
		unpinChatMessage: (_chatId: string, _msgId: number) => Promise.resolve(true),
	},
}
const limiter = new RateLimiter(0)
setRelayCtx(tg as any, db, limiter, limiter)
relayCtx.groups = groups

// (i) Concurrent LID-only then PN+alt sightings for one contact. The
// in-flight lock is keyed by every variant, so only one topic is created.
const lid = '11111111111111@lid'
const pn = '15551230000@s.whatsapp.net'
const [lidResult, pnResult] = await Promise.all([
	ensureTopicMapping(lid, 'Ana', '1:1', false, { aliases: [lid] }),
	ensureTopicMapping(pn, 'Ana', '1:1', false, { aliases: [lid, pn] }),
])
const anaRows = db.getAllActive().filter((row) =>
	row.whatsapp_jid === lid || row.whatsapp_jid === pn
)
check('one topic for LID/PN pair', anaRows.length === 1)
check('one createForumTopic call', created === 1)
check('both callers get the same topic', lidResult?.topicId === pnResult?.topicId)
check('canonical row is the PN', anaRows[0]?.whatsapp_jid === pn)

// (ii) Split-brain row: bucket business but the topic is still in the
// personal group. It must classify as needs-move, then reconcile must
// repoint the bucket to the host before the real move.
const splitJid = '15559990000@s.whatsapp.net'
db.getOrCreate(splitJid, 77, 'Business Person', '1:1', groups.personal)
db.setBucket(splitJid, 'business')
const split = db.getByJid(splitJid)!
check('split-brain needs move', needsMove(split, 'business', groups))
const repointed = reconcileSplitBrain(db, splitJid, groups)!
check('split-brain repointed to host bucket', repointed.bucket === 'personal')
check('repointed row still needs the move', needsMove(repointed, 'business', groups))
const moveResult = await moveTopic(splitJid, 'business')
check('move reported', moveResult?.moved === true)
const moved = db.getByJid(splitJid)!
check('moved bucket is business', moved.bucket === 'business')
check('moved topic is in the business group', moved.telegram_chat_id === groups.business)
check('moved row no longer needs move', !needsMove(moved, 'business', groups))

// (iii) Boot reconcile: a duplicate LID/PN pair joined by an alias keeps
// the newest topic, repoints replies, aliases the loser and archives it.
const dupLid = '22222222222222@lid'
const dupPn = '15557770000@s.whatsapp.net'
db.getOrCreate(dupLid, 201, 'Dup Person', '1:1', groups.personal)
db.getOrCreate(dupPn, 202, 'Dup Person', '1:1', groups.personal)
db.addAlias(dupLid, dupPn)
const merged = db.reconcileDuplicateMappings()
check('duplicate LID/PN pair merged', merged === 1)
const dupWinner = db.getAllActive().find((row) =>
	row.whatsapp_jid === dupLid || row.whatsapp_jid === dupPn
)
check('newest topic survived', dupWinner?.whatsapp_jid === dupPn)
check('newest topic id kept', dupWinner?.telegram_topic_id === 202)
check('loser archived', db.getByJid(dupLid)?.archived === true)
check('loser resolves to winner', db.getByJidOrAlias(dupLid)?.whatsapp_jid === dupPn)

// (iv) Muted chats stay put: no move, no bucket repoint.
const mutedJid = '15558880000@s.whatsapp.net'
db.getOrCreate(mutedJid, 88, 'Muted Person', '1:1', groups.personal)
db.setBucket(mutedJid, 'personal')
db.setMuted(mutedJid, true)
const mutedResult = await moveTopic(mutedJid, 'business')
check('muted move returns null', mutedResult === null)
const mutedAfter = db.getByJid(mutedJid)!
check('muted bucket stays personal', mutedAfter.bucket === 'personal')
check('muted topic stays in personal', mutedAfter.telegram_chat_id === groups.personal)
const mutedReconcile = reconcileSplitBrain(db, mutedJid, groups)!
check('muted reconcile leaves bucket alone', mutedReconcile.bucket === 'personal')

// (v) Single-group setup: personal and business share one group, so
// bucketOfChat always says business. Reconcile must leave an undecided
// row alone instead of auto-classifying it.
const singleGroups = { personal: 'G', business: 'G', legacy: 'G' }
const singleJid = '15556660000@s.whatsapp.net'
db.getOrCreate(singleJid, 99, 'Single Person', '1:1', singleGroups.personal)
const singleReconcile = reconcileSplitBrain(db, singleJid, singleGroups)!
check('single-group reconcile leaves bucket undecided', singleReconcile.bucket === 'undecided')
check('single-group row still undecided in db', db.getByJid(singleJid)?.bucket === 'undecided')
check(
	'single-group undecided needs no personal move',
	!needsMove(singleReconcile, 'personal', singleGroups),
)
check(
	'single-group undecided still moves to business',
	needsMove(singleReconcile, 'business', singleGroups),
)

db.close()
Deno.removeSync(dir, { recursive: true })
if (failures > 0) {
	console.error(`${failures} check(s) failed`)
	Deno.exit(1)
}
console.log('all bridge bucket smokes passed')
