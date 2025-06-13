import { Baileys, defaults, gemini, prisma, User } from '../map.js'

export default function reminder(bot: Baileys) {
	if (!process.env.DATABASE_URL) return

	checkReminders(bot)
	setInterval(async () => checkReminders(bot), 1_000 * 60)
	return
}

async function checkReminders(bot: Baileys) {
	let reminders = await prisma.reminders.findMany({
		orderBy: { remindAt: 'asc' },
		where: { isDone: false },
	}) // fetch all reminders

	reminders = reminders.filter((r) => Number(r.remindAt) < Date.now())
	// filter for pending reminders

	for (const r of reminders) {
		print(r.msg)
		sendReminders(bot, r)
			.then(() =>
				prisma.reminders.update({
					where: { id: r.id },
					data: { isDone: true },
				})
			)
			.catch((e) => console.log(r, e.message))
	}
	return
}

async function sendReminders(bot: Baileys, r: Reminder) {
	const user = await bot.getUser({ id: r.author }) as User
	const lang = `langs.${user!.lang}`.t('en') || 'Portuguese'

	let text = `\`${r.msg.replaceAll('`', '\`')}\`\n@${user.phone}`

	const aiMsg = await gemini({
		prompt:
			`Create a humorous message to notify a WhatsApp user of a reminder in ${lang}. Just respond with the reminder. Reminder: ${r.msg}`,
		model: defaults.ai.gemini,
	}).catch(() => {})

	text += aiMsg?.text ? `, ${aiMsg.text}` : ''

	// send remind msg
	await bot.sock.sendMessage(r.chat, { text, mentions: [user.chat] })
	return
}
