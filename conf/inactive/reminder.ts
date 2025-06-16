import { defaults, gemini, prisma, User } from '../map.js'
import { getUser } from '../util/prisma.js'
import bot from '../wa.js'

export default function reminder() {
	if (!process.env.DATABASE_URL) return

	checkReminders()
	setInterval(async () => checkReminders(), 1_000 * 60)
	return
}

async function checkReminders() {
	let reminders = await prisma.reminders.findMany({
		orderBy: { remindAt: 'asc' },
		where: { isDone: false },
	}) // fetch all reminders

	reminders = reminders.filter((r) => Number(r.remindAt) < Date.now())
	// filter for pending reminders

	for (const r of reminders) {
		print(r.msg)
		sendReminders(r)
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

async function sendReminders(r: Reminder) {
	const user = await getUser({ id: r.author }) as User
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
