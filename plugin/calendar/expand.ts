// expand - date expansion and dedup helpers
import type { CalendarEvent, DayMonth } from './types.ts'
import { parseDateStr } from './blocks.ts'

export function normalizeActivity(s: string): string {
	return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-z0-9]/g, '').trim()
}

export function areDuplicateActivities(a: string, b: string): boolean {
	const nA = normalizeActivity(a)
	const nB = normalizeActivity(b)
	if (!nA || !nB) return false
	if (nA === nB) return true
	if (nA.includes(nB) || nB.includes(nA)) {
		const minLen = Math.min(nA.length, nB.length)
		const maxLen = Math.max(nA.length, nB.length)
		if (minLen / maxLen > 0.65) return true
	}
	return false
}

export function addEvent(
	d: DayMonth,
	ev: CalendarEvent,
	events: Record<string, CalendarEvent[]>,
	clearExisting: boolean,
	year: number,
	isExclusion = false,
): void {
	if (!d.day || d.day < 1 || d.day > 31) return
	if (!d.month || d.month < 1 || d.month > 12) return
	const key = `${d.day.toString().padStart(2, '0')}/${
		d.month.toString().padStart(2, '0')
	}/${year}`
	if (!events[key]) events[key] = []
	if (clearExisting) events[key] = []
	if (isExclusion) {
		events[key] = events[key].filter((e) => !areDuplicateActivities(e.atividade, ev.atividade))
		return
	}
	const existingIndex = events[key].findIndex((e) =>
		areDuplicateActivities(e.atividade, ev.atividade)
	)
	if (existingIndex !== -1) {
		const existing = events[key][existingIndex]
		if (!existing.dateRange && ev.dateRange) existing.dateRange = ev.dateRange
		if (!existing.grupo && ev.grupo) existing.grupo = ev.grupo
		if (!existing.responsavel && ev.responsavel) existing.responsavel = ev.responsavel
		if (
			ev.atividade.length > existing.atividade.length && !existing.atividade.includes('...')
		) {
			existing.atividade = ev.atividade
		}
	} else {
		events[key].push({ ...ev })
	}
}

export function expandDates(
	dateRaw: string,
	ev: CalendarEvent,
	events: Record<string, CalendarEvent[]>,
	clearExisting = false,
	eventYear: number,
	isExclusion = false,
): void {
	const originalDateRaw = dateRaw.replace(/(\d)\s*a\s*(?=\d|$)/g, '$1 a ')
		.replace(/(\d)\s*e\s*(?=\d|$)/g, '$1 e ').replace(/\s+/g, ' ').trim()
	dateRaw = dateRaw.replace(/012\/2027/, '1/2/2027')
	dateRaw = dateRaw.replace(/\/\d{4}/g, '')
	const segments = dateRaw.split(/\s*(?:e|,)\s*/)
	const parsedSegments = segments.map((seg) => {
		const parts = seg.split(/\s*a\s*/)
		if (parts.length === 1) return { type: 'single' as const, d: parseDateStr(parts[0]) }
		return {
			type: 'range' as const,
			start: parseDateStr(parts[0]),
			end: parseDateStr(parts[1]),
		}
	})
	let lastMonth = 0
	for (let i = parsedSegments.length - 1; i >= 0; i--) {
		const p = parsedSegments[i]
		if (p.type === 'single' && p.d) {
			if (p.d.month !== 0) lastMonth = p.d.month
			else if (lastMonth !== 0) p.d.month = lastMonth
		} else if (p.type === 'range' && p.start && p.end) {
			if (p.end.month !== 0) lastMonth = p.end.month
			else if (lastMonth !== 0) p.end.month = lastMonth
			if (p.start.month === 0) p.start.month = p.end.month
			else lastMonth = p.start.month
		}
	}
	for (const p of parsedSegments) {
		if (p.type === 'single' && p.d) {
			if (!p.d.month) continue
			ev.dateRange = originalDateRaw
			addEvent(p.d, ev, events, clearExisting, eventYear, isExclusion)
		} else if (p.type === 'range' && p.start && p.end) {
			if (!p.start.month || !p.end.month) continue
			const startD = new Date(eventYear, p.start.month - 1, p.start.day)
			const endD = new Date(eventYear, p.end.month - 1, p.end.day)
			if (startD > endD) continue
			ev.dateRange = originalDateRaw
			for (const d = new Date(startD); d <= endD; d.setDate(d.getDate() + 1)) {
				addEvent(
					{ day: d.getDate(), month: d.getMonth() + 1 },
					ev,
					events,
					clearExisting,
					eventYear,
					isExclusion,
				)
			}
		}
	}
}
