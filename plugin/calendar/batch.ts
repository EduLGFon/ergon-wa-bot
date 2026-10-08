// batch - base table batch flush helper
import type { CalendarEvent, TableLine, TextBlock } from './types.ts'
import { expandDates } from './expand.ts'
import { getBlocks } from './blocks.ts'

export function flushTableBatch(
	tableLines: TableLine[],
	events: Record<string, CalendarEvent[]>,
): boolean {
	for (let i = 0; i < tableLines.length; i++) {
		if (tableLines[i].dPart.match(/[ae]$/)) {
			for (let j = i + 1; j < tableLines.length; j++) {
				if (tableLines[j].dPart) {
					const center = Math.floor((i + j) / 2)
					tableLines[center].dPart = tableLines[i].dPart.replace(/([ae])$/, ' $1 ') +
						tableLines[j].dPart
					if (center !== i) tableLines[i].dPart = ''
					if (center !== j) tableLines[j].dPart = ''
					i = j
					break
				}
			}
		}
	}
	const centers: number[] = []
	for (let i = 0; i < tableLines.length; i++) {
		if (tableLines[i].dPart.match(/^\d{1,2}/)) centers.push(i)
	}
	if (centers.length === 0) {
		tableLines.length = 0
		return false
	}
	const gBlocks = getBlocks(tableLines, (l) => l.gPart)
	const rBlocks = getBlocks(tableLines, (l) => l.rPart)
	const aBlocks = getBlocks(tableLines, (l) => l.aPart)
	const assignments: Record<number, { g: TextBlock[]; r: TextBlock[]; a: TextBlock[] }> = {}
	for (const c of centers) assignments[c] = { g: [], r: [], a: [] }
	for (const b of aBlocks) {
		const distances = centers.map((c) => ({ c, d: Math.abs(c - b.centerIdx) }))
		distances.sort((a, b) => a.d - b.d)
		let chosenCenter = distances[0].c
		if (distances.length > 1 && distances[0].d === distances[1].d) {
			chosenCenter = Math.min(distances[0].c, distances[1].c)
		}
		assignments[chosenCenter].a.push(b)
	}
	for (const c of centers) {
		const currentP = tableLines[c].periodo
		const validG = gBlocks.filter((b) =>
			tableLines[Math.floor(b.centerIdx)].periodo === currentP
		)
		if (validG.length > 0) {
			if (!tableLines[c].gPart.trim() && tableLines[c].afterBreak) {
				validG.sort((a, b) => Math.abs(a.centerIdx - c) - Math.abs(b.centerIdx - c))
				let picked = validG[0]
				if (picked.centerIdx > c && picked.centerIdx - c > 3) {
					const above = validG.filter((b) => b.centerIdx < c)
						.sort((a, b) => b.centerIdx - a.centerIdx)
					if (above.length > 0) picked = above[0]
				}
				assignments[c].g.push(picked)
			} else {
				validG.sort((a, b) => Math.abs(a.centerIdx - c) - Math.abs(b.centerIdx - c))
				if (
					validG.length > 1 &&
					Math.abs(validG[0].centerIdx - c) === Math.abs(validG[1].centerIdx - c)
				) {
					assignments[c].g.push(
						validG[1].centerIdx < validG[0].centerIdx ? validG[1] : validG[0],
					)
				} else {
					assignments[c].g.push(validG[0])
				}
			}
		}
		const validR = rBlocks.filter((b) =>
			tableLines[Math.floor(b.centerIdx)].periodo === currentP
		)
		if (validR.length > 0) {
			validR.sort((a, b) => Math.abs(a.centerIdx - c) - Math.abs(b.centerIdx - c))
			if (
				validR.length > 1 &&
				Math.abs(validR[0].centerIdx - c) === Math.abs(validR[1].centerIdx - c)
			) {
				assignments[c].r.push(
					validR[1].centerIdx < validR[0].centerIdx ? validR[1] : validR[0],
				)
			} else {
				assignments[c].r.push(validR[0])
			}
		}
	}
	for (const c of centers) {
		const assignment = assignments[c]
		const localG = assignment.g.map((b) => b.lines.join(' ').replace(/\s+/g, ' ').trim()).join(
			' ',
		).trim()
		const localR = assignment.r.map((b) => b.lines.join(' ').replace(/\s+/g, ' ').trim()).join(
			' ',
		).trim()
		const fullAtiv = assignment.a.map((b) => b.lines.join(' ').replace(/\s+/g, ' ').trim())
			.join(' ').trim()
		const dateStr = tableLines[c].dPart.replace(/\s+/g, ' ').trim()
		if (
			dateStr && fullAtiv && !fullAtiv.includes('AÇÕES REFERENTES AO') &&
			!dateStr.includes('AÇÕES REFERENTES')
		) {
			expandDates(
				dateStr,
				{
					periodo: tableLines[c].periodo,
					grupo: localG,
					responsavel: localR,
					atividade: fullAtiv,
				},
				events,
				false,
				tableLines[c].year,
			)
		}
	}
	tableLines.length = 0
	return true
}
