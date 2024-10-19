import settings from '../settings/settings.json' with { type: 'json' }
import { api, Baileys, gemini } from '../map.js'
import express from 'express'
const app = express()

export function server(bot: Baileys) {
	return new Promise((res) => start(bot, res))
}

function start(bot: Baileys, resolve: Function) {
	app
		.use(express.json()) // use content-type: json
		.get('/ping', async (_req, res) => {
			res.sendStatus(200)
		})
		.post('/reminder', async (req, res) => { // method: post
			const r: Reminder = req.body

			if (!r.id || !r.author || !r.chat || !r.msg || !r.remindAt) {
				res.sendStatus(404)
			} else res.send(sendReminders(bot, r))
			return
		})
		.listen(settings.bot.port, () => {
			print('SERVER', `Started on ${settings.bot.port}`, 'gray')
			resolve(true)
		})
}

async function sendReminders(bot: Baileys, r: Reminder) {
	try {
		let text = `@${r.author}\n`
		const aiMsg = await gemini({
			instruction:
				'Create only one humorous message to notify a user of a reminder in the following template. Always respond in Portuguese and on template.\ntemplate: "humorous message \n `reminder`"\nreminder: ',
			prompt: r.msg,
			model: api.aiModel.gemini,
		})

		if (!aiMsg || !aiMsg.text || !aiMsg.text.includes(r.msg)) text += '`' + r.msg + '`'
		else text += aiMsg.text

		// send remind msg
		await bot.sock.sendMessage(r.chat, { text, mentions: [r.author + '@s.whatsapp.net'] })
		return 200
	} catch (e) {
		console.error(e, 'SERVER')
		return
	}
}
