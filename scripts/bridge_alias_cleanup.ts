// bridge_alias_cleanup - audit and purge poisoned jid_alias rows.
//
// A past wa-to-tg bug stored group sender alts as chat aliases (user PN ->
// group) plus heal artifacts (group -> user, group -> group). Only user-user
// LID<->PN pairs are legitimate. Dry-run by default, --yes deletes:
//
//   deno run -A scripts/bridge_alias_cleanup.ts
//   deno run -A scripts/bridge_alias_cleanup.ts --yes
import { DatabaseSync } from 'node:sqlite'

const DB_PATH = 'conf/gen/bridge.db'
const POISON_WHERE = `NOT (
			(alias LIKE '%@lid' OR alias LIKE '%@s.whatsapp.net') AND
			(canonical LIKE '%@lid' OR canonical LIKE '%@s.whatsapp.net')
		)`

function run(): void {
	const apply = Deno.args.includes('--yes')
	const db = new DatabaseSync(DB_PATH)
	try {
		const poison = db.prepare(
			`SELECT alias, canonical FROM jid_aliases WHERE ${POISON_WHERE} ORDER BY alias`,
		).all() as { alias: string; canonical: string }[]
		const total = (db.prepare('SELECT count(*) AS n FROM jid_aliases').get() as { n: number }).n
		console.log(`${poison.length} poisoned rows of ${total} total aliases.`)
		for (const r of poison.slice(0, 50)) console.log(`poison: ${r.alias} -> ${r.canonical}`)
		if (poison.length > 50) console.log(`... and ${poison.length - 50} more`)
		if (!apply) {
			console.log(
				'Dry-run: rerun with --yes to delete. Normal bot boot also purges via db.init().',
			)
			return
		}
		db.prepare(`DELETE FROM jid_aliases WHERE ${POISON_WHERE}`).run()
		const left = (db.prepare('SELECT count(*) AS n FROM jid_aliases').get() as { n: number }).n
		console.log(`Purged ${poison.length} rows, ${left} legitimate user-user aliases remain.`)
		console.log(
			'Note: chats whose mapping was stolen keep the topic; the next message from the',
		)
		console.log('deleted group/user recreates a fresh topic automatically.')
	} finally {
		db.close()
	}
}

try {
	run()
} catch (e) {
	console.error(`bridge_alias_cleanup: ${e instanceof Error ? e.message : e}`)
	Deno.exit(1)
}
