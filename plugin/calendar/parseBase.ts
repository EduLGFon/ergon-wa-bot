// parseBase - base calendar text parsing
import { findSplitIndex, normalizeDatePart } from './blocks.ts'
import type { CalendarEvent, TableLine } from './types.ts'
import { flushTableBatch } from './batch.ts'

export function parseBaseCalendarText(
	text: string,
	baseYear: number,
): Record<string, CalendarEvent[]> {
	const lines = text.split('\n')
	const events: Record<string, CalendarEvent[]> = {}
	let inTable = false
	let rIdx = -1, dIdx = -1, aIdx = -1
	let currentPeriodo = ''
	let currentYear = baseYear
	const tableLines: TableLine[] = []
	let batchCrossedBreak = false
	const ignoreKeywords = [
		'UNIVERSIDADE FEDERAL DO ESPÍRITO SANTO',
		'CONSELHO DE ENSINO',
		'ESTA RESOLUÇÃO FOI ALTERADA',
		'*Data estabelecida',
		'**PA:',
		'RESOLUÇÃO/CEPE',
		'ANEXO I DA RESOLUÇÃO',
	]
	const processTableLines = () => {
		if (tableLines.length === 0) {
			batchCrossedBreak = false
			return
		}
		if (flushTableBatch(tableLines, events)) batchCrossedBreak = false
	}
	for (const line of lines) {
		const lineClean = line.replace(/\r/g, '').replace(/\bPprofessor\b/g, 'Professor').trimEnd()
		if (ignoreKeywords.some((kw) => lineClean.includes(kw))) {
			if (inTable) batchCrossedBreak = true
			continue
		}
		const refMatch = lineClean.match(/AÇÕES REFERENTES.*?(PERÍODO.*)/i)
		if (refMatch) {
			currentPeriodo = refMatch[1].trim()
			continue
		}
		const monthMatch = lineClean.match(/^\s*([A-ZÇ]+)\/\s*(\d{4})/)
		if (monthMatch && lineClean.toLowerCase().includes('dias letivos')) {
			processTableLines()
			inTable = false
			currentYear = parseInt(monthMatch[2])
			continue
		}
		if (lineClean.toLowerCase().includes('dias letivos')) {
			processTableLines()
			inTable = false
			continue
		}
		if (
			lineClean.includes('Grupo de atividades') && lineClean.includes('Atividade') &&
			lineClean.includes('Data')
		) {
			processTableLines()
			inTable = true
			rIdx = lineClean.indexOf('Responsável')
			dIdx = lineClean.indexOf('Data')
			aIdx = lineClean.indexOf('Atividade')
			continue
		}
		if (inTable && dIdx !== -1 && aIdx !== -1) {
			let localRIdx = rIdx
			let localDIdx = dIdx
			let localAIdx = aIdx
			const dateMatch = lineClean.match(
				/(?:\s|^)(\d{1,2}(?:\/\d{1,2})?(?:\s+a\s+\d{1,2})?(?:\/\d{1,2})?)(?:\s|$)/,
			)
			if (dateMatch && dateMatch.index !== undefined) {
				const actualDIdx = dateMatch.index + dateMatch[0].indexOf(dateMatch[1])
				if (Math.abs(actualDIdx - dIdx) < 25) {
					const shift = actualDIdx - dIdx
					if (shift < 0) localRIdx = Math.max(0, rIdx + shift)
					localDIdx = Math.max(0, dIdx + shift)
					localAIdx = Math.max(0, aIdx + shift)
				}
			}
			const rSplit = findSplitIndex(lineClean, localRIdx, true)
			const dSplit = findSplitIndex(lineClean, localDIdx)
			const aSplit = findSplitIndex(lineClean, localAIdx)
			const gPart = lineClean.substring(0, rSplit).trim()
			let rPart = lineClean.substring(rSplit, dSplit).trim()
			let dPart = normalizeDatePart(lineClean.substring(dSplit, aSplit).trim())
			let aPart = lineClean.substring(aSplit).trim()
			if (!dPart && rPart.match(/^\d{1,2}(?:\/\d{1,2})?\s*[ae]$/)) {
				dPart = rPart
				rPart = ''
			}
			const datePrefix = dPart.match(
				/^(\d{1,2}(?:\/\d{1,2})?(?:\s+[ae]\s+\d{1,2}(?:\/\d{1,2})?|\s*[ae](?=\s|$))?(?:\s*(?:e|,)\s*\d{1,2}(?:\/\d{1,2})?)*)/i,
			)
			if (datePrefix && datePrefix[1].length < dPart.length) {
				const rest = dPart.slice(datePrefix[1].length).trim()
				dPart = datePrefix[1].trim()
				if (rest) aPart = rest + (aPart ? ' ' + aPart : '')
			}
			if (dPart && !/\d/.test(dPart)) {
				aPart = dPart + (aPart ? ' ' + aPart : '')
				dPart = ''
			}
			if (dPart && !dPart.match(/^[0-9a-zA-Z]/)) dPart = ''
			if (aPart && !aPart.match(/^[\p{L}\p{N}()"'\-]/u)) aPart = ''
			if (rPart === 'bloqueio de' && !aPart) {
				aPart = 'bloqueio de'
				rPart = ''
			}
			if (gPart || rPart || dPart || aPart) {
				tableLines.push({
					gPart,
					rPart,
					dPart,
					aPart,
					periodo: currentPeriodo,
					year: currentYear,
					afterBreak: batchCrossedBreak,
				})
			}
		}
	}
	processTableLines()
	return events
}
