// setup-bridge - optional Telegram bridge env prompts - Deno-only
//
// The WhatsApp <-> Telegram mirror is a side feature: the token, forum
// supergroups, owner id and rate-limit tuning are only collected when the
// user opts in. Answers write straight into the .env map so any bridge keys
// that are already configured survive untouched.
export function esc(v: string | null): string {
	return `'${(v ?? '').replace(/'/g, `'"'"'`)}'`
}

const YES = new Set(['y', 'yes', '1'])
const askYes = (q: string): boolean => YES.has((prompt(q) || '').trim().toLowerCase())

// Prompt for the optional Telegram bridge config, mutating nextEnv (the map
// that is written to conf/.env afterward). Skipping leaves the bridge
// disabled or keeps whatever the user already configured.
export function promptBridge(nextEnv: Map<string, string>): void {
	console.log('\n=========================================')
	console.log('  Optional: Telegram Bridge Setup        ')
	console.log('=========================================')
	console.log(
		'Mirror WhatsApp chats into Telegram forum supergroups with one bot\n' +
			'and two supergroups (personal + business columns). Skipping disables\n' +
			'the bridge or keeps anything already configured.',
	)
	if (!askYes('\nConfigure the Telegram bridge now? [y/N]: ')) {
		console.log('Skipping Telegram bridge setup.')
		return
	}

	const token = prompt('\nEnter Telegram Bot Token (from @BotFather, e.g. 123:abc): ')
	if (!token?.trim()) {
		console.log('No token entered - the bridge stays unconfigured.')
		return
	}
	nextEnv.set('TELEGRAM_BOT_TOKEN', esc(token.trim()))

	console.log('\nSupergroup layout:')
	console.log('  1. Single group (personal and business share one supergroup)')
	console.log('  2. Two groups (personal and business separated)')
	const dual = (prompt('\nChoose [1-2] (default: 1): ') || '1').trim() === '2'

	console.log(
		'\nSupergroup IDs: enable Topics in each supergroup, add the bot as an\n' +
			'admin (can_manage_topics), then run:\n' +
			'  deno run -A --env=conf/.env bridge/mod.ts -- --find-id',
	)
	const personal = prompt('\nEnter Personal supergroup ID: ')
	const business = dual ? prompt('\nEnter Business supergroup ID: ') : null

	const pid = personal?.trim()
	if (pid) nextEnv.set('TELEGRAM_SUPERGROUP_PERSONAL', esc(pid))
	if (dual) {
		if (business?.trim()) nextEnv.set('TELEGRAM_SUPERGROUP_BUSINESS', esc(business.trim()))
		else {
			console.warn('No business ID - business chats will fall back to the personal group.')
		}
	} else {
		// Single mode routes both buckets through the legacy ID.
		if (pid) nextEnv.set('TELEGRAM_SUPERGROUP_ID', esc(pid))
	}

	const owner = prompt(
		'\nEnter your Telegram user ID for @all/@mention pings (optional, enter to skip): ',
	)
	if (owner?.trim()) nextEnv.set('TELEGRAM_OWNER_ID', esc(owner.trim()))

	console.log('\nRate-limit tuning (defaults are fine for most setups):')
	if (askYes('Tune the send pacing now? [y/N]: ')) {
		const tg = prompt('Telegram send spacing in ms (default 3000): ')
		if (tg?.trim()) nextEnv.set('TELEGRAM_RATE_LIMIT_MS', esc(tg.trim()))
		const wa = prompt('WhatsApp send spacing in ms (default 500): ')
		if (wa?.trim()) nextEnv.set('WHATSAPP_RATE_LIMIT_MS', esc(wa.trim()))
		const retries = prompt('Max retries per send after a flood error (default 5): ')
		if (retries?.trim()) nextEnv.set('RATE_LIMIT_MAX_RETRIES', esc(retries.trim()))
		const maxWait = prompt('Cap for a single flood wait in ms (default 120000): ')
		if (maxWait?.trim()) nextEnv.set('RATE_LIMIT_MAX_WAIT_MS', esc(maxWait.trim()))
	}

	console.log('Telegram bridge configured.')
}
