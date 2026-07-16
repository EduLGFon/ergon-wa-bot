import { updateCalendarCache } from '../plugin/calendarParser.ts'
import { existsSync, readFileSync } from 'node:fs'

async function run() {
	console.log('Forcing calendar cache update to use new parsing logic...')
	await updateCalendarCache()
	console.log('Update complete.\n')

	const year = new Date().getFullYear()
	const calendarPath = `conf/gen/cache/calendar_${year}.json`

	if (!existsSync(calendarPath)) {
		console.error('Cache file not found after update!')
		return
	}

	const events: Record<string, any[]> = JSON.parse(
		readFileSync(calendarPath, 'utf-8'),
	)

	// Iterate over all days of the year
	const d = new Date(year, 0, 1)
	while (d.getFullYear() === year) {
		const day = d.getDate().toString().padStart(2, '0')
		const month = (d.getMonth() + 1).toString().padStart(2, '0')
		const key = `${day}/${month}/${year}`

		const todayEvents = events[key]
		if (todayEvents && todayEvents.length > 0) {
			console.log(`\n===========================================`)
			console.log(`📅 HOJE NA UFES - ${day}/${month}`)
			console.log(`===========================================`)

			const eventsByPeriod: Record<string, any[]> = {}
			for (const e of todayEvents) {
				const p = e.periodo || 'GERAL'
				if (!eventsByPeriod[p]) eventsByPeriod[p] = []
				eventsByPeriod[p].push(e)
			}

			for (const p in eventsByPeriod) {
				console.log(`\n*[${p}]*`)
				for (const e of eventsByPeriod[p]) {
					let prefix = ''
					if (e.grupo || e.responsavel) {
						const g = e.grupo ? e.grupo : ''
						const r = e.responsavel ? ` (${e.responsavel})` : ''
						prefix = `${g}${r}: `
					}
					let range = ''
					if (e.dateRange) range = ` (${e.dateRange})`

					console.log(` 🔸 ${prefix}${e.atividade}${range}`)
				}
			}
		}
		d.setDate(d.getDate() + 1)
	}
}

run().catch(console.error)
