import { randomDelay } from '../util/functions.js'
import prisma, { getUser } from './prisma.js'
import { send } from '../util/messages.js'
import { User } from '../map.js'

export { createAlarms, getUserAlarms, sendAlarms }

let alarmTimeout: NodeJS.Timeout
let nextAlarmTime = 0
const alarmRegex = /{ALARM:.+:[0-9].+}/gi

async function sendAlarms() {
	if (!process.env.DATABASE_URL) return // there is no DB
	const alarms: Alarm[] = await prisma.alarms.findMany({
		where: {
			status: 0, // only get alarms that are not sent
		},
		orderBy: {
			time: 'asc', // order by time ascending
		},
	})

	for (const a of alarms) {
		const time = Number(a.time) // alarm alert time

		if (time > Date.now()) continue // not its time rn
		// we need to get Date.now() every time to
		// avoid negative time on schedule
		const user = await getUser({ id: a.author })

		try {
			// send alarm to chat mentioning user
			await send.bind(a.chat)({
				text: `@${user!.phone}\n- 🔔 *Alarme:* \`${a.msg}\` `,
				mentions: [user!.lid],
			})
			await prisma.alarms.update({
				where: { id: a.id },
				data: { status: 1 }, // alarm was sent
			})
			a.status = 1
			print('ALARM', `'${a.msg}' to ${user!.phone} (${a.chat})`, 'blue')
		} catch (e: any) {
			print('ALARM', e.stack, 'red')
		}

		// wait some seconds before sending the next alarm
		await randomDelay()
	}

	const nextAlarm = alarms
		.filter((a) => !a.status)
		.sort((a, b) => Number(a.time) - Number(b.time))[0]
	if (!nextAlarm) {
		clearTimeout(alarmTimeout)
		nextAlarmTime = 0
		return
	}

	const time = Number(nextAlarm.time)
	// create a timeout for the next alarm
	scheduleAlarmCheck(time)
	return
}

function scheduleAlarmCheck(time: num) { // set timeout for the next alarm check
	let duration = time - Date.now()
	if (duration > 2147483647) { // bruh moment
		/** setTimeout() only accepts 32 bit signed integers as duration
		 * but this timeout duration exploted the limit (-2^31 to 2^31 - 1)
		 * what it means is that the timeout duration is too big (more than 24 days 21 hours)
		 * but NodeJS can't handle it and is going to replace it
		 * and this will make this function to be called every 1ms.
		 * it will overflow the stack and db and boom.
		 */
		// so we are going to change it to 2^31 - 1
		duration = 2147483647
	}
	clearTimeout(alarmTimeout)
	nextAlarmTime = time // this one we can let normal way bc it's only used
	// for time comparisons
	print('timeout duration:', duration, 'red')
	alarmTimeout = setTimeout(sendAlarms, duration)
}

// createAlarm: set user alarms
async function createAlarms(user: User, msg: AIMsg, chat: str) {
	// regex matches
	const matches = msg.text.match(alarmRegex)
	if (!matches) return msg.text // no alarms found

	for (const alarm of matches) {
		const duration = alarm.split(':')[2].slice(0, -1).toMs()
		// get duration from {ALARM:msg:duration}
		const time = Date.now() + duration[0]
		// alarm absolute time
		const message = alarm.split(':')[1].trim()

		// replace {ALARM:msg:duration} with the text alarm
		msg.text = msg.text.replace(alarm, '')
		msg.header += `- 🔔 *Alarme criado:* \`${message}\` em \`${duration[1]}\`\n`

		// set alarm in database
		await prisma.alarms.create({
			data: {
				author: user.id,
				chat,
				msg: message, // get alarm from {ALARM:msg:duration}
				time: String(time),
			},
		})

		// create a timeout for the next alarm
		if (!nextAlarmTime || time < nextAlarmTime) scheduleAlarmCheck(time)
	}
	return
}

async function getUserAlarms(user: User) { // get all alarms created by the user
	if (!process.env.DATABASE_URL) return ['Nenhum alarme.']
	const alarms: Alarm[] = await prisma.alarms.findMany({ where: { author: user.id } })

	if (!alarms[0]) return ['Nenhum alarme.']

	return alarms.map((r) =>
		`MESSAGE: "${r.msg}". TIME: "${new Date(r.time).toLocaleString(user.lang)}"`
	)
}
