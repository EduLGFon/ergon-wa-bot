import settings from '../settings/settings.json' with { type: 'json' }
import { Baileys } from '../map.js'
import express from 'express'
const app = express()

export function server(bot: Baileys) {
	app
		.use(express.json())
		.post('/reminder', async (req, res) => {
			const r: Reminder = req.body

			if (!r.id || !r.author || !r.chat || !r.msg || !r.remindAt) {
				return res.send('missing data')
			}

			return res.send(sendReminders(bot, r))
		})
		.listen(settings.bot.port, () => print('SERVER', `Started on ${settings.bot.port}`, 'gray'))
}

async function sendReminders(bot: Baileys, r: Reminder) {
	try {
		const text = `\`${r.msg}\``
		await bot.sock.sendMessage(r.chat, { text })
		return 200
	} catch (e: any) {
		return e.message
	}
}
