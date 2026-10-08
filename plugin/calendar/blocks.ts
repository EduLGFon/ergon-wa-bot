// blocks - text block grouping and column helpers
import type { TableLine, TextBlock } from './types.ts'

export function getBlocks(
	tableLines: TableLine[],
	extractFn: (line: TableLine) => string,
): TextBlock[] {
	const blocks: TextBlock[] = []
	let currentBlock: TextBlock | null = null
	for (let i = 0; i < tableLines.length; i++) {
		const text = extractFn(tableLines[i])
		if (!text) continue
		let isNewBlock = false
		if (!currentBlock) {
			isNewBlock = true
		} else {
			const gap = i - currentBlock.endIdx - 1
			if (gap > 1) {
				isNewBlock = true
			} else {
				let prevText = ''
				for (let j = i - 1; j >= 0; j--) {
					if (extractFn(tableLines[j])) {
						prevText = extractFn(tableLines[j])
						break
					}
				}
				const firstChar = text.trim()[0]
				const prevEndsWithContinuation = prevText.trim().match(/[-–,\/]$/) ||
					prevText.trim().match(/\b(de|da|do|e|ou|para|com|em)\s*$/i)
				if (
					firstChar && firstChar === firstChar.toUpperCase() &&
					firstChar.match(/[A-ZÁÉÍÓÚÇ]/)
				) {
					if (!prevEndsWithContinuation) isNewBlock = true
				}
			}
		}
		if (isNewBlock) {
			if (currentBlock) {
				currentBlock.centerIdx = (currentBlock.startIdx + currentBlock.endIdx) / 2
				blocks.push(currentBlock)
			}
			currentBlock = { startIdx: i, endIdx: i, lines: [text], centerIdx: i }
		} else {
			currentBlock!.endIdx = i
			currentBlock!.lines.push(text)
		}
	}
	if (currentBlock) {
		currentBlock.centerIdx = (currentBlock.startIdx + currentBlock.endIdx) / 2
		blocks.push(currentBlock)
	}
	return blocks
}

export function findSplitIndex(line: string, hint: number, preferLeft = false): number {
	if (hint <= 0 || hint >= line.length) return hint
	if (preferLeft && line[hint] !== ' ') {
		let left = hint
		while (left > 0 && line[left] !== ' ') left--
		return left
	}
	if (line[hint] === ' ' && line[hint - 1] === ' ') return hint
	let left = hint
	while (left > 0 && line[left] !== ' ') left--
	let right = hint
	while (right < line.length && line[right] !== ' ') right++
	if (hint - left <= right - hint) return left
	return right
}

export function normalizeDatePart(dPart: string): string {
	const collapsed = dPart.match(/^(\d{2})(\d)\s*a$/)
	if (collapsed) {
		const day = parseInt(collapsed[1])
		const month = parseInt(collapsed[2])
		if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
			return `${collapsed[1]}/${collapsed[2]} a`
		}
	}
	return dPart
}

export function parseDateStr(s: string): { day: number; month: number } | null {
	const m = s.trim().match(/^(\d{1,2})(?!\d)(?:\/(\d{1,2})(?!\d))?/)
	if (!m) return null
	const day = parseInt(m[1])
	const month = m[2] ? parseInt(m[2]) : 0
	if (day < 1 || day > 31) return null
	if (month < 0 || month > 12) return null
	return { day, month }
}
