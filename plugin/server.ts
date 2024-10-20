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
		const user = await bot.getUser({ id: r.author })
		const lang = `langs.${user!.lang}`.t('en') || 'Portuguese'

		let text = `\`${r.msg.replaceAll('`', '\`')}\`\n@${user.phone}`

		const aiMsg = await gemini({
			instruction:
				`Create only one humorous message to notify a user of a reminder in ${lang}.\nreminder: `,
			prompt: r.msg,
			model: api.aiModel.gemini,
		})

		text += aiMsg?.text ? `, ${aiMsg?.text}` : ''

		// send remind msg
		await bot.sock.sendMessage(r.chat, { text, mentions: [user.chat] })
		return 200
	} catch (e) {
		console.error(e, 'SERVER')
		return
	}
}
