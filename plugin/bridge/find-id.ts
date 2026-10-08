// Standalone helper: print a supergroup ID for conf/.env.
//
// `deno run -A bridge/mod.ts -- --find-id` never touches WhatsApp - it
// reads recent bot updates and prints the first group chat found. Run it
// once per group (personal, business) after adding the bot and sending a
// message there.
import { Bot } from 'grammy'

export async function findSupergroupId(): Promise<void> {
	const token = Deno.env.get('TELEGRAM_BOT_TOKEN')
	if (!token) {
		console.error('Missing TELEGRAM_BOT_TOKEN in env')
		Deno.exit(1)
	}

	const bot = new Bot(token)
	const updates = await bot.api.getUpdates({ limit: 100 })

	for (const update of updates as any[]) {
		const chat = update.message?.chat || update.edited_message?.chat ||
			update.channel_post?.chat
		if (chat && (chat.type === 'supergroup' || chat.type === 'group')) {
			console.log(`\nSupergroup ID: \`${chat.id}\`\n`)
			console.log(
				`Copy this ID and set it as TELEGRAM_SUPERGROUP_PERSONAL or TELEGRAM_SUPERGROUP_BUSINESS in conf/.env.`,
			)
			console.log(`Chat title: ${chat.title || 'N/A'}`)
			console.log(`Is forum: ${chat.is_forum || false}`)
			Deno.exit(0)
		}
	}

	console.log('No supergroup found in recent updates.')
	console.log('Make sure the bot is added to the supergroup and send a message there first.')
}
