// import defaults from 'defaults' with { type: 'json' }
// import { startTelegram } from 'plugin/telegram.ts'
import { sendReminders } from 'util/reminders.ts'
// import bot from 'main'

// When the bot is online
export default function () {
	console.log('WA', 'Ready', 'green')

	sendReminders()
	// send user reminders.
	// you could create one using gemini AI.

	// if (defaults.telegram.token) startTelegram(bot)
}
