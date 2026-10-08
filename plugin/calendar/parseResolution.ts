// parseResolution - resolution pdf text parsing
import type { CalendarEvent } from './types.ts'
import { expandDates } from './expand.ts'

export function parseResolutionText(
	text: string,
	baseEvents: Record<string, CalendarEvent[]>,
	baseYear: number,
): void {
	const lines = text.split('\n')
	let inQuote = false
	let isExclusion = false
	let currentEventLines: string[] = []
	function flushEvent(): void {
		if (currentEventLines.length === 0) return
		const cleanStr = currentEventLines.join(' ').replace(/^"/, '')
			.replace(/”\(NR\)$/, '').replace(/"$/, '').trim()
		if (cleanStr.match(/^\.+$/)) {
			currentEventLines = []
			return
		}
		const match = cleanStr.match(/^([\d\s/ae]+)\s*[-–]\s*(.+)/i)
		if (match) {
			const dateRaw = match[1].trim()
			const ativ = match[2].trim()
			if (!isExclusion) {
				expandDates(
					dateRaw,
					{
						periodo: 'RESOLUÇÃO/CEPE',
						grupo: 'Atualização',
						responsavel: 'CEPE',
						atividade: ativ,
					},
					baseEvents,
					false,
					baseYear,
				)
			} else {
				expandDates(
					dateRaw,
					{
						periodo: '',
						grupo: '',
						responsavel: '',
						atividade: ativ,
					},
					baseEvents,
					false,
					baseYear,
					true,
				)
			}
		}
		currentEventLines = []
	}
	for (const line of lines) {
		const lineClean = line.trim()
		if (!lineClean) continue
		if (lineClean.includes('exclui o item:')) isExclusion = true
		if (
			lineClean.includes('passa a vigorar com as seguintes') ||
			lineClean.includes('R E S O L V E')
		) isExclusion = false
		if (lineClean.startsWith('"') || lineClean.startsWith('“')) {
			flushEvent()
			inQuote = true
		}
		if (inQuote) {
			if (
				currentEventLines.length > 0 &&
				lineClean.match(
					/^(\d{1,3}(?:\/\d{1,2})?(?:\/\d{4})?(?:\s*[ae]\s*\d{1,2}\/\d{1,2}(?:\/\d{4})?)?)\s*[-–]/,
				)
			) {
				flushEvent()
			}
			currentEventLines.push(lineClean)
			if (
				lineClean.endsWith('"') || lineClean.endsWith('”') ||
				lineClean.endsWith('”(NR)')
			) {
				flushEvent()
				inQuote = false
				isExclusion = false
			}
		}
	}
	flushEvent()
}
