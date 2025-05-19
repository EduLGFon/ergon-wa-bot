import db, { getUser } from 'plugin/db.ts'
import { delay } from 'util/functions.ts'
import User from 'class/user.ts'
import bot from 'main'

export { createReminders, getUserReminders, reminderRegex, sendReminders }

let reminderTimeout: num
let nextReminderTime = 0
const reminderRegex = /{REMINDER:( |)[a-z].+:[0-9].+}/gi

async function sendReminders() {
	const reminders: Reminder[] = db.queryEntries(`SELECT * FROM reminders WHERE status = 0`)

	for (const r of reminders) {
		const time = Number(r.time)
		// reminder alert time

		if (time > Date.now()) continue
		const user = getUser({ id: r.author })

		// send reminder to chat mentioning user
		await bot.sendMessage(r.chat, `@${user.phone}\n- *Lembrete:* \`${r.msg}\` `)
			.then(() => {
				db.query(`UPDATE reminders SET status = 1 WHERE id = :id`, { id: r.id })
				console.log('REMINDER', `'${r.msg}' to ${user.phone} (${r.chat})`, 'blue')
			})
			.catch((e) => console.log('REMINDER', e.stack, 'red'))

		// wait 3 seconds before sending the next reminder
		await delay(3_000)
	}

	const nextReminder = reminders.sort((a, b) => Number(a.time) - Number(b.time))[0]
	if (!nextReminder) {
		clearTimeout(reminderTimeout)
		nextReminderTime = 0
		return
	}

	const time = Number(nextReminder.time)
	// create a timeout for the next reminder
	scheduleReminderCheck(time)
	return
}

// scheduleReminderCheck: set timeout for the next reminder check
function scheduleReminderCheck(time: num) {
	clearTimeout(reminderTimeout)
	nextReminderTime = time
	reminderTimeout = setTimeout(sendReminders, time - Date.now())
}

// createReminder: set user reminders
function createReminders(user: User, text: str, chat: str) {
	// regex matches
	const matches = text.match(reminderRegex)!
	const textReminders: str[] = []

	for (const reminder of matches) {
		const duration = reminder.split(':')[2].slice(0, -1).toMs()
		// get duration from {REMINDER:reminder:duration}
		const time = Date.now() + duration[0]
		// reminder absolute time

		// set reminder in database
		db.query(
			`insert into reminders (author, chat, msg, time) values (:author, :chat, :msg, :time)`,
			{
				author: user.id,
				chat,
				msg: reminder.split(':')[1], // get reminder from {REMINDER:reminder:duration}
				time,
			},
		)
		textReminders.push(
			`- *Lembrete adicionado:* \`${reminder.split(':')[1]}\` em \`${duration[1]}\``,
		)

		// create a timeout for the next reminder
		if (!nextReminderTime || time < nextReminderTime) scheduleReminderCheck(time)
	}

	// replace {REMINDER:reminder:duration} with the text reminder
	matches.forEach((m, i) => text = text.replace(m, textReminders[i])) // remove reminders from text

	return text
}

// getUserReminders: get all reminders created by the user
function getUserReminders(user: User) {
	const reminders: Reminder[] = db.queryEntries(
		`SELECT * FROM reminders WHERE author = :author`,
		{
			author: user.id,
		},
	)
	if (!reminders) return ['Nenhum lembrete encontrado.']

	return reminders.map((r) =>
		`MESSAGE: "${r.msg}". TIME: "${new Date(r.time).toLocaleString(user.lang)}"`
	)
}
