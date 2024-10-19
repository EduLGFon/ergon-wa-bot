import settings from '../settings/settings.json' with { type: 'json' }
import { api, Baileys, gemini } from '../map.js'
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
		let text = ''
		const aiMsg = await gemini({
			instruction:
				'Create a humorous message to notify a user of a reminder in the following template. Always respond in Portuguese.\ntemplate: "humorous message \n `reminder`"\nreminder: ',
			prompt: r.msg,
			model: api.aiModel.gemini,
		})

		if (!aiMsg || !aiMsg.text || !aiMsg.text.includes(r.msg)) text = '`' + r.msg + '`'
		else text = aiMsg.text

		await bot.sock.sendMessage(r.chat, { text })
		return 200
	} catch (e: any) {
		return e.message
	}
}
