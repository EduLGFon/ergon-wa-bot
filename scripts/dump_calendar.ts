import { updateCalendarCache } from '@plugin/calendarParser.ts'
import { existsSync } from 'jsr:@std/fs'

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
		Deno.readTextFileSync(calendarPath),
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
			console.log(`🎓 Calendário Acadêmico - ${day}/${month}`)
			console.log(`===========================================`)

			const eventsByPeriod: Record<string, any[]> = {}
			for (const e of todayEvents) {
				const p = e.periodo || 'GERAL'
				if (!eventsByPeriod[p]) eventsByPeriod[p] = []
				eventsByPeriod[p].push(e)
			}

			for (const p in eventsByPeriod) {
				console.log(`\n*[${p}]*`)
				for (
					const e of eventsByPeriod[p].sort((a, b) => {
						const rA = (a.responsavel || '').trim().toLowerCase()
						const rB = (b.responsavel || '').trim().toLowerCase()

						const getScore = (r: string) => {
							if (r === 'estudante' || r === 'estudantes') return 1
							if (r === 'professor' || r === 'professores') return 3
							return 4
						}
						return getScore(rA) - getScore(rB)
					})
				) {
					let prefix = ''
					if (e.grupo || e.responsavel) {
						const g = e.grupo ? e.grupo : ''
						const r = e.responsavel ? ` (${e.responsavel})` : ''
						prefix = `${g}${r}: `
					}
					let range = ''
					if (e.dateRange) range = ` (${e.dateRange})`

					const eventLine = `${prefix}${e.atividade}${range}`
					const resp = (e.responsavel || '').trim().toLowerCase()
					const isEstudante = resp === 'estudante' || resp === 'estudantes'

					if (isEstudante) {
						console.log(` 🚨 *${eventLine}*`)
					} else {
						console.log(` 🔸 ${eventLine}`)
					}
				}
			}
		}
		d.setDate(d.getDate() + 1)
	}
}

run().catch(console.error)
