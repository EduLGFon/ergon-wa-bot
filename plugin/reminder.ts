import settings from '../settings/settings.json' with { type: 'json' }
import { prisma } from '../map.js'

console.log('Reminder ready!')
setInterval(async () => {
	let reminders = await prisma.reminders.findMany({ orderBy: { remindAt: 'asc' } })

	reminders = reminders.filter((r) => Number(r.remindAt) < Date.now())

	for (const r of reminders) {
		console.log(r)

		await fetch(`http://localhost:${settings.bot.port}/reminder`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(r),
		})
			.then(() => prisma.reminders.delete({ where: { id: r.id } }))
			.catch((e) => console.log(r, e.message))
	}
}, 1_000 * 5)
