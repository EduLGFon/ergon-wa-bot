import { areDuplicateActivities, CalendarEvent } from '@plugin/calendarParser.ts'

export interface ClassifiedCalendar {
	hasEvents: boolean
	hasNewEventsToday: boolean
	newStudentEvents: CalendarEvent[]
	endingTodayEvents: CalendarEvent[]
	ongoingStudentEvents: CalendarEvent[]
	otherEvents: CalendarEvent[]
	rawFormattedBlock: string
	summaryText: string
}

function deduplicateEvents(list: CalendarEvent[]): CalendarEvent[] {
	const result: CalendarEvent[] = []
	for (const ev of list) {
		const existingIndex = result.findIndex((e) =>
			areDuplicateActivities(e.atividade, ev.atividade)
		)
		if (existingIndex !== -1) {
			const existing = result[existingIndex]
			if (!existing.dateRange && ev.dateRange) existing.dateRange = ev.dateRange
			if (!existing.grupo && ev.grupo) existing.grupo = ev.grupo
			if (!existing.responsavel && ev.responsavel) existing.responsavel = ev.responsavel
			if (
				ev.atividade.length > existing.atividade.length &&
				!existing.atividade.includes('...')
			) {
				existing.atividade = ev.atividade
			}
		} else {
			result.push({ ...ev })
		}
	}
	return result
}

export function analyzeCalendarEvents(
	events: Record<string, CalendarEvent[]>,
	currentDate: Date = new Date(),
): ClassifiedCalendar {
	const pad = (n: number) => (n < 10 ? '0' + n : n.toString())
	const day = pad(currentDate.getDate())
	const month = pad(currentDate.getMonth() + 1)
	const year = currentDate.getFullYear().toString()

	const todayKey = `${day}/${month}/${year}`

	// Calculate yesterday and tomorrow
	const yDate = new Date(currentDate)
	yDate.setDate(yDate.getDate() - 1)
	const yesterdayKey = `${pad(yDate.getDate())}/${
		pad(yDate.getMonth() + 1)
	}/${yDate.getFullYear()}`

	const tDate = new Date(currentDate)
	tDate.setDate(tDate.getDate() + 1)
	const tomorrowKey = `${pad(tDate.getDate())}/${
		pad(tDate.getMonth() + 1)
	}/${tDate.getFullYear()}`

	const todayEvents = deduplicateEvents(events[todayKey] || [])
	const yesterdayEvents = deduplicateEvents(events[yesterdayKey] || [])
	const tomorrowEvents = deduplicateEvents(events[tomorrowKey] || [])

	if (todayEvents.length === 0) {
		return {
			hasEvents: false,
			hasNewEventsToday: false,
			newStudentEvents: [],
			endingTodayEvents: [],
			ongoingStudentEvents: [],
			otherEvents: [],
			rawFormattedBlock: '',
			summaryText: 'Nada agendado para hoje.',
		}
	}

	const newStudentEvents: CalendarEvent[] = []
	const endingTodayEvents: CalendarEvent[] = []
	const ongoingStudentEvents: CalendarEvent[] = []
	const otherEvents: CalendarEvent[] = []

	for (const e of todayEvents) {
		const resp = (e.responsavel || '').trim().toLowerCase()
		const isStudent = resp.includes('estudante')

		const isNew = !yesterdayEvents.some((y) => areDuplicateActivities(y.atividade, e.atividade))
		const isEnding = !tomorrowEvents.some((t) =>
			areDuplicateActivities(t.atividade, e.atividade)
		)

		if (isEnding) {
			endingTodayEvents.push(e)
		}

		if (isStudent) {
			if (isNew) {
				newStudentEvents.push(e)
			} else if (!isEnding) {
				ongoingStudentEvents.push(e)
			}
		} else {
			if (!isEnding) {
				otherEvents.push(e)
			}
		}
	}

	const hasNewEventsToday = newStudentEvents.length > 0

	// Format raw official block (Deterministic Detalhamento)
	let rawFormattedBlock = `🎓 *Calendário Acadêmico:*\n`
	const eventsByPeriod: Record<string, CalendarEvent[]> = {}
	for (const e of todayEvents) {
		const p = e.periodo || 'GERAL'
		if (!eventsByPeriod[p]) eventsByPeriod[p] = []
		eventsByPeriod[p].push(e)
	}

	for (const p in eventsByPeriod) {
		rawFormattedBlock += `\n*[${p}]*\n`

		eventsByPeriod[p].sort((a, b) => {
			const rA = (a.responsavel || '').trim().toLowerCase()
			const rB = (b.responsavel || '').trim().toLowerCase()

			const getScore = (r: string) => {
				if (r.includes('estudante')) return 1
				if (r.includes('professor')) return 3
				return 4
			}
			return getScore(rA) - getScore(rB)
		})

		for (const e of eventsByPeriod[p]) {
			let prefix = ''
			if (e.grupo || e.responsavel) {
				const g = e.grupo ? e.grupo : ''
				const r = e.responsavel ? ` (${e.responsavel})` : ''
				prefix = `${g}${r}: `
			}
			let range = ''
			if (e.dateRange) {
				range = ` (${e.dateRange})`
			}

			const eventLine = `${prefix}${e.atividade}${range}`
			const resp = (e.responsavel || '').trim().toLowerCase()
			const isEstudante = resp.includes('estudante')

			if (isEstudante) {
				rawFormattedBlock += ` 🚨 *${eventLine}*\n`
			} else {
				rawFormattedBlock += ` 🔸 ${eventLine}\n`
			}
		}
	}

	// Build deterministic summary lines
	const summaryLines: string[] = []

	if (hasNewEventsToday) {
		for (const e of newStudentEvents) {
			const deadline = e.dateRange ? ` *(até ${getEndDate(e.dateRange)})*` : ''
			summaryLines.push(`  🚨 *Estudante (Novo hoje):* ${e.atividade}${deadline}`)
		}
	} else {
		summaryLines.push(`  • _Nada de novo em relação a ontem._`)
	}

	if (endingTodayEvents.length > 0) {
		const endingNames = endingTodayEvents.map((e) => {
			const who = e.responsavel ? ` _(${e.responsavel})_` : ''
			return `${e.atividade}${who}`
		}).join('; ')
		summaryLines.push(`  ⏳ *Último dia hoje:* ${endingNames}`)
	}

	if (ongoingStudentEvents.length > 0) {
		for (const e of ongoingStudentEvents) {
			const deadline = e.dateRange ? ` *(até ${getEndDate(e.dateRange)})*` : ''
			summaryLines.push(`  📌 *Em andamento:* ${e.atividade}${deadline}`)
		}
	}

	if (summaryLines.length === 1 && !hasNewEventsToday && otherEvents.length > 0) {
		summaryLines.push(`  ℹ️ *Eventos docentes/gerais em andamento.*`)
	}

	return {
		hasEvents: true,
		hasNewEventsToday,
		newStudentEvents,
		endingTodayEvents,
		ongoingStudentEvents,
		otherEvents,
		rawFormattedBlock: rawFormattedBlock.trimEnd(),
		summaryText: summaryLines.join('\n'),
	}
}

function getEndDate(dateRange: string): string {
	const parts = dateRange.split(/\s+a\s+/)
	if (parts.length > 1) {
		return parts[1].trim()
	}
	return dateRange.trim()
}
