// bridge_buckets - bulk personal/business classification for the bridge.
//
// Lists every bridged chat with its current bucket, then stamps/moves chats
// to a desired bucket through the same moveTopic() the buttons use:
//
//   deno run -A --env-file=conf/.env scripts/bridge_buckets.ts
//   deno run -A --env-file=conf/.env scripts/bridge_buckets.ts --file buckets.txt
//   deno run -A --env-file=conf/.env scripts/bridge_buckets.ts --yes 12345@g.us=business
//
// buckets.txt lines look like `12345@g.us=business` (# comments allowed).
// Unlisted chats keep their bucket (use --default to stamp the rest).
// Dry-run by default - nothing moves without --yes.
import { chatOfBucket, groupIds, isDual } from '../plugin/bridge/wa-to-tg/routing.ts'
import { setRelayCtx } from '../plugin/bridge/wa-to-tg/state.ts'
import { moveTopic } from '../plugin/bridge/wa-to-tg/move.ts'
import { RateLimiter } from '../plugin/bridge/rate-limiter.ts'
import { BridgeDB } from '../plugin/bridge/db.ts'
import { Bot } from 'grammy'

const DB_PATH = 'conf/gen/bridge.db'

function usage(): void {
	console.log(`Usage:
  bridge_buckets.ts [--yes] [--default personal|business] [--file buckets.txt] [JID=bucket ...]

  No targets: list all bridged chats with their bucket.
  Without --yes: dry-run, prints the plan without moving anything.`)
}

type Wanted = 'personal' | 'business'

function parseArgs(args: string[]): {
	yes: boolean
	def: Wanted | null
	file: string | null
	targets: Map<string, Wanted>
} {
	const targets = new Map<string, Wanted>()
	let yes = false
	let def: Wanted | null = null
	let file: string | null = null
	for (let i = 0; i < args.length; i++) {
		const a = args[i]
		if (a === '--yes') yes = true
		else if (a === '--default') {
			const v = (args[++i] || '').toLowerCase()
			if (v !== 'personal' && v !== 'business') {
				throw new Error('--default takes personal|business')
			}
			def = v
		} else if (a === '--file') {
			file = args[++i] || null
			if (!file) throw new Error('--file needs a path')
		} else if (a === '--help' || a === '-h') {
			usage()
			Deno.exit(0)
		} else if (/^[^=]+=(personal|business)$/i.test(a)) {
			const [jid, bucket] = a.split('=')
			if (!jid.includes('@')) throw new Error(`Not a JID: ${jid}`)
			targets.set(jid, bucket.toLowerCase() as Wanted)
		} else {
			throw new Error(`Unknown arg: ${a}`)
		}
	}
	if (file) {
		for (const line of Deno.readTextFileSync(file).split('\n')) {
			const clean = line.split('#')[0].trim()
			if (!clean) continue
			const [jid, bucket] = clean.split('=').map((s) => s.trim())
			if (!jid?.includes('@') || (bucket !== 'personal' && bucket !== 'business')) {
				throw new Error(`Bad line in ${file}: ${line}`)
			}
			targets.set(jid, bucket)
		}
	}
	return { yes, def, file, targets }
}

function groupLabel(chatId: string, ids: { personal: string; business: string }): string {
	if (chatId === ids.business && chatId === ids.personal) return 'single'
	if (chatId === ids.business) return 'business-group'
	if (chatId === ids.personal) return 'personal-group'
	return chatId || 'unknown-group'
}

async function run(): Promise<void> {
	const { yes, def, targets } = parseArgs(Deno.args)
	const ids = groupIds()
	if (!ids.personal) {
		console.error('Set TELEGRAM_SUPERGROUP_PERSONAL (or legacy TELEGRAM_SUPERGROUP_ID).')
		Deno.exit(1)
	}
	const db = new BridgeDB(DB_PATH)
	db.init(ids.legacy || ids.personal)
	const chats = db.getAllActive()
	if (!isDual(ids)) console.log('Single-group mode: classifications are stamped, nothing moves.')

	if (targets.size === 0 && !def) {
		for (const c of chats) {
			console.log(
				`${c.whatsapp_jid}=${c.bucket}  # ${c.display_name} [${c.chat_type}] topic #${c.telegram_topic_id} in ${
					groupLabel(c.telegram_chat_id, ids)
				}`,
			)
		}
		console.log(`\n${chats.length} chats. Save edits as JID=bucket lines, rerun with --file.`)
		db.close()
		return
	}

	// Explicit targets may use an alias variant (@lid vs PN) - resolve
	// every target key to its canonical mapping JID first.
	const wanted = new Map<string, Wanted>()
	for (const [key, bucket] of targets) {
		const canonical = db.getByJidOrAlias(key)?.whatsapp_jid ?? key
		wanted.set(canonical, bucket)
	}
	const plan = chats.map((c) => ({ c, want: wanted.get(c.whatsapp_jid) ?? def })).filter(
		(p) =>
			p.want &&
			(p.c.bucket !== p.want || p.c.telegram_chat_id !== chatOfBucket(p.want!, ids)),
	)
	for (const p of plan) {
		const home = chatOfBucket(p.want!, ids)
		const arrow = p.c.bucket === p.want ? 'stamp' : `${p.c.bucket}->${p.want}`
		const replay =
			p.want === 'personal' && p.c.telegram_chat_id !== chatOfBucket('personal', ids)
				? ' (replay<=100)'
				: ''
		const blocked = !home
			? ' SKIP (target group unconfigured)'
			: (p.c.muted ? ' SKIP (muted)' : '')
		console.log(`${arrow} ${p.c.whatsapp_jid} [${p.c.display_name}]${replay}${blocked}`)
	}
	if (!yes) {
		console.log(`\nDry-run: ${plan.length} change(s). Rerun with --yes to apply.`)
		db.close()
		return
	}
	const token = Deno.env.get('TELEGRAM_BOT_TOKEN')
	if (!token) {
		console.error('TELEGRAM_BOT_TOKEN required to move topics.')
		Deno.exit(1)
	}
	setRelayCtx(new Bot(token), db, new RateLimiter(3000))
	let moved = 0
	for (const p of plan) {
		if (!chatOfBucket(p.want!, ids) || p.c.muted) continue
		try {
			const r = await moveTopic(p.c.whatsapp_jid, p.want!)
			if (!r) {
				console.log(`${p.c.whatsapp_jid}: skipped (archived since planning)`)
				continue
			}
			console.log(
				`${p.c.whatsapp_jid}: ${
					r.moved ? `moved (copied ${r.copied}, skipped ${r.skipped})` : 'stamped'
				}`,
			)
			if (r.moved) moved++
		} catch (e) {
			console.error(`${p.c.whatsapp_jid}: FAILED - ${e}`)
		}
	}
	console.log(`Done: ${moved} moved, ${plan.length - moved} stamped.`)
	db.close()
}

try {
	await run()
} catch (e) {
	console.error(`bridge_buckets: ${e instanceof Error ? e.message : e}`)
	usage()
	Deno.exit(1)
}
