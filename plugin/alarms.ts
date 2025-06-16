import prisma, { getUser } from './prisma.js'
import { randomDelay } from '../util/functions.js'
import { send } from '../util/messages.js'
import { User } from '../map.js'

export { createAlarms, getUserAlarms, sendAlarms }

let alarmTimeout: NodeJS.Timeout
let nextAlarmTime = 0
const alarmRegex = /{ALARM:( |)[a-z].+:[0-9].+}/gi

async function sendAlarms() {
	const alarms: Alarm[] = await prisma.alarms.findMany({
		where: { // only get alarms that are not sent
			status: 0,
		},
		orderBy: { // order by time ascending
			time: 'asc',
		},
	})

	for (const a of alarms) {
		const time = Number(a.time)
		// alarm alert time

		if (time > Date.now()) continue
		const user = await getUser({ id: a.author })

		// send alarm to chat mentioning user
		await send.bind(a.chat)({
			text: `@${user!.phone}\n- 🔔 *Alarme:* \`${a.msg}\` `,
			mentions: [user!.chat],
		})
			.then(async () => {
				await prisma.alarms.update({
					where: { id: a.id },
					data: { status: 1 },
				})
				console.log('ALARM', `'${a.msg}' to ${user!.phone} (${a.chat})`, 'blue')
			})
			.catch((e) => console.log('ALARM', e.stack, 'red'))

		// wait some seconds before sending the next alarm
		await randomDelay()
	}

	const nextAlarm = alarms.sort((a, b) => Number(a.time) - Number(b.time))[0]
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

// scheduleAlarmCheck: set timeout for the next alarm check
function scheduleAlarmCheck(time: num) {
	clearTimeout(alarmTimeout)
	nextAlarmTime = time
	alarmTimeout = setTimeout(sendAlarms, time - Date.now())
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

		// set alarm in database
		await prisma.alarms.create({
			data: {
				author: user.id,
				chat,
				msg: message, // get alarm from {ALARM:msg:duration}
				time: String(time),
			},
		})

		// replace {ALARM:msg:duration} with the text alarm
		msg.text = msg.text.replace(alarm, '') // remove alarm from text
		msg.header += `- 🔔 *Alarme criado:* \`${message}\` em \`${duration[1]}\`\n`

		// create a timeout for the next alarm
		if (!nextAlarmTime || time < nextAlarmTime) scheduleAlarmCheck(time)
		return
	}
}

// getUserAlarms: get all alarms created by the user
async function getUserAlarms(user: User) {
	const alarms: Alarm[] = await prisma.alarms.findMany({ where: { author: user.id } })

	if (!alarms[0]) return ['Nenhum alarme encontrado.']

	return alarms.map((r) =>
		`MESSAGE: "${r.msg}". TIME: "${new Date(r.time).toLocaleString(user.lang)}"`
	)
}
