/** Redirector:
 * Send all WA msgs to a Telegram group
 * and send all Telegram msgs on there to WA Chats
 */
import { TelegramBot } from 'typescript-telegram-bot-api'

const token = process.env.TELEGRAM_TOKEN!
const bot = new TelegramBot({
	botToken: token,
	autoRetry: true,
	autoRetryLimit: 120,
})

bot.startPolling()
	.then(() => {
		console.log('ready!')
		bot.getMe().then(console.log)
	})
	.catch(console.error)

bot.on('message', (msg) => {
	console.log(msg.text, msg.chat)
	console.log(msg.from, msg.via_bot)
})

//-deno run --unstable-hmr --no-lock -A --env=settings/.env -c settings/deno.jsonc plugin/telegram.ts
