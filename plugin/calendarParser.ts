interface TextBlock {
	startIdx: number
	endIdx: number
	lines: string[]
	centerIdx: number
}

function getBlocks(
	tableLines: any[],
	extractFn: (line: any) => string,
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
				const prevEndsWithContinuation =
					prevText.trim().match(/[-–,\/]$/) ||
					prevText.trim().match(/\b(de|da|do|e|ou|para|com|em)\s*$/i)

				if (
					firstChar && firstChar === firstChar.toUpperCase() &&
					firstChar.match(/[A-ZÁÉÍÓÚÇ]/)
				) {
					if (!prevEndsWithContinuation) {
						isNewBlock = true
					}
				}
			}
		}

		if (isNewBlock) {
			if (currentBlock) {
				currentBlock.centerIdx =
					(currentBlock.startIdx + currentBlock.endIdx) /
					2
				blocks.push(currentBlock)
			}
			currentBlock = {
				startIdx: i,
				endIdx: i,
				lines: [text],
				centerIdx: i,
			}
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

import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { existsSync } from 'node:fs'

const execAsync = promisify(exec)

export async function fetchCalendarLinks(
	year: number,
): Promise<{ base: string; resolutions: string[] }> {
	const url = 'https://prograd.ufes.br/calendario'
	const res = await fetch(url)
	if (!res.ok) throw new Error(`Failed to fetch ${url}`)
	const html = await res.text()

	const baseRegex = new RegExp(
		`<a[^>]*href="([^"]+)"[^>]*>\\s*-\\s*${year}\\s*</a>\\s*-\\s*Cursos presenciais`,
		'i',
	)
	const baseMatch = html.match(baseRegex)

	if (!baseMatch) {
		throw new Error(
			`Could not find base calendar for ${year} - Cursos presenciais`,
		)
	}

	let baseLink = baseMatch[1]
	if (baseLink.startsWith('/')) baseLink = 'https://prograd.ufes.br' + baseLink

	const resolutions: string[] = []

	const htmlAfter = html.slice(baseMatch.index! + baseMatch[0].length)
	const paragraphs = htmlAfter.split('</p>')
	for (const p of paragraphs) {
		if (p.includes('rteindent1') && p.includes('href="')) {
			const linkMatch = p.match(/<a[^>]*href="([^"]+)"/i)
			if (linkMatch) {
				let link = linkMatch[1]
				if (link.startsWith('/')) link = 'https://prograd.ufes.br' + link
				resolutions.push(link)
			}
		} else if (
			p.trim().length > 0 && !p.includes('rteindent1') && !p.includes('<br')
		) {
			const textContent = p.replace(/<[^>]+>/g, '').trim()
			if (textContent.length > 5) break
		}
	}

	return { base: baseLink, resolutions: resolutions.reverse() }
}

async function downloadAndConvertPdf(url: string, destTxt: string) {
	const destPdf = destTxt.replace('.txt', '.pdf')
	await execAsync(`curl -sL "${url}" -o "${destPdf}"`)
	await execAsync(`pdftotext -layout "${destPdf}" "${destTxt}"`)
	return await readFile(destTxt, 'utf-8')
}

export interface CalendarEvent {
	periodo: string
	grupo: string
	responsavel: string
	atividade: string
	dateRange?: string
}

export function parseBaseCalendarText(
	text: string,
	baseYear: number,
): Record<string, CalendarEvent[]> {
	const lines = text.split('\n')
	const events: Record<string, CalendarEvent[]> = {}

	let inTable = false
	let gIdx = -1, rIdx = -1, dIdx = -1, aIdx = -1

	let currentPeriodo = ''
	let currentYear = baseYear

	type TableLine = {
		gPart: string
		rPart: string
		dPart: string
		aPart: string
		periodo: string
		year: number
	}
	const tableLines: TableLine[] = []

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
		if (tableLines.length === 0) return

		for (let i = 0; i < tableLines.length; i++) {
			if (tableLines[i].dPart.match(/a$/)) {
				for (let j = i + 1; j < tableLines.length; j++) {
					if (tableLines[j].dPart) {
						const center = Math.floor((i + j) / 2)
						tableLines[center].dPart =
							tableLines[i].dPart.replace(/a$/, ' a ') +
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
			return
		}

		const gBlocks = getBlocks(tableLines, (l) => l.gPart)
		const rBlocks = getBlocks(tableLines, (l) => l.rPart)
		const aBlocks = getBlocks(tableLines, (l) => l.aPart)

		const assignments: Record<number, any> = {}
		for (const c of centers) assignments[c] = { g: [], r: [], a: [] }

		// aBlocks: Block finds closest Center (ensures no Activity is lost)
		for (const b of aBlocks) {
			const distances = centers.map((c) => ({
				c,
				d: Math.abs(c - b.centerIdx),
			}))
			distances.sort((a, b) => a.d - b.d)
			let chosenCenter = distances[0].c
			if (distances.length > 1 && distances[0].d === distances[1].d) {
				chosenCenter = Math.min(distances[0].c, distances[1].c)
			}
			assignments[chosenCenter].a.push(b)
		}

		// gBlocks and rBlocks: Center finds closest Block (naturally handles vertical spans)
		for (const c of centers) {
			const currentP = tableLines[c].periodo

			const validG = gBlocks.filter((b) =>
				tableLines[Math.floor(b.centerIdx)].periodo === currentP
			)
			if (validG.length > 0) {
				validG.sort((a, b) =>
					Math.abs(a.centerIdx - c) - Math.abs(b.centerIdx - c)
				)
				if (
					validG.length > 1 &&
					Math.abs(validG[0].centerIdx - c) ===
						Math.abs(validG[1].centerIdx - c)
				) {
					assignments[c].g.push(
						validG[1].centerIdx < validG[0].centerIdx
							? validG[1]
							: validG[0],
					)
				} else {
					assignments[c].g.push(validG[0])
				}
			}

			const validR = rBlocks.filter((b) =>
				tableLines[Math.floor(b.centerIdx)].periodo === currentP
			)
			if (validR.length > 0) {
				validR.sort((a, b) =>
					Math.abs(a.centerIdx - c) - Math.abs(b.centerIdx - c)
				)
				if (
					validR.length > 1 &&
					Math.abs(validR[0].centerIdx - c) ===
						Math.abs(validR[1].centerIdx - c)
				) {
					assignments[c].r.push(
						validR[1].centerIdx < validR[0].centerIdx
							? validR[1]
							: validR[0],
					)
				} else {
					assignments[c].r.push(validR[0])
				}
			}
		}

		for (const c of centers) {
			const assignment = assignments[c]
			const localG = assignment.g.map((b: TextBlock) =>
				b.lines.join(' ').replace(/\s+/g, ' ').trim()
			).join(' ').trim()
			const localR = assignment.r.map((b: TextBlock) =>
				b.lines.join(' ').replace(/\s+/g, ' ').trim()
			).join(' ').trim()
			const fullAtiv = assignment.a.map((b: TextBlock) =>
				b.lines.join(' ').replace(/\s+/g, ' ').trim()
			).join(' ').trim()

			let dateStr = tableLines[c].dPart.replace(/\s+/g, ' ').trim()
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
	}

	for (const line of lines) {
		const lineClean = line.replace(/\r/g, '').replace(
			/\bPprofessor\b/g,
			'Professor',
		).trimEnd()

		if (
			lineClean.match(/ESTA RESOLUÇÃO/i) || lineClean.match(/^\s*\*Data/i) ||
			lineClean.match(/^\s*\*\*PA:/i)
		) {
			processTableLines()
			inTable = false
			continue
		}

		if (ignoreKeywords.some((kw) => lineClean.includes(kw))) continue

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

		if (
			lineClean.includes('Grupo de atividades') &&
			lineClean.includes('Atividade') && lineClean.includes('Data')
		) {
			processTableLines()
			inTable = true
			gIdx = lineClean.indexOf('Grupo de atividades')
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
				const actualDIdx = dateMatch.index +
					dateMatch[0].indexOf(dateMatch[1])
				if (Math.abs(actualDIdx - dIdx) < 25) {
					const shift = actualDIdx - dIdx
					localRIdx = Math.max(0, rIdx + shift)
					localDIdx = Math.max(0, dIdx + shift)
					localAIdx = Math.max(0, aIdx + shift)
				}
			}

			const rSplit = findSplitIndex(lineClean, localRIdx)
			const dSplit = findSplitIndex(lineClean, localDIdx)
			const aSplit = findSplitIndex(lineClean, localAIdx)

			let gPart = lineClean.substring(0, rSplit).trim()
			let rPart = lineClean.substring(rSplit, dSplit).trim()
			let dPart = lineClean.substring(dSplit, aSplit).trim()
			let aPart = lineClean.substring(aSplit).trim()

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
				})
			}
		}
	}
	processTableLines()
	return events
}

function findSplitIndex(line: string, hint: number): number {
	if (hint <= 0 || hint >= line.length) return hint
	if (line[hint] === ' ' && line[hint - 1] === ' ') return hint

	let left = hint
	while (left > 0 && line[left] !== ' ') left--

	let right = hint
	while (right < line.length && line[right] !== ' ') right++

	if (hint - left <= right - hint) {
		return left
	} else {
		return right
	}
}

export function parseResolutionText(
	text: string,
	baseEvents: Record<string, CalendarEvent[]>,
	baseYear: number,
) {
	const lines = text.split('\n')
	let inQuote = false
	let isExclusion = false
	let currentEventLines: string[] = []

	function flushEvent() {
		if (currentEventLines.length === 0) return

		let cleanStr = currentEventLines.join(' ')
			.replace(/^"/, '')
			.replace(/”\(NR\)$/, '')
			.replace(/"$/, '')
			.trim()

		if (cleanStr.match(/^\.+$/)) {
			currentEventLines = []
			return
		}

		const match = cleanStr.match(/^([\d\s/ae]+)\s*[-–]\s*(.+)/i)
		if (match) {
			let dateRaw = match[1].trim()
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
					true,
					baseYear,
				)
			}
		}
		currentEventLines = []
	}

	for (const line of lines) {
		let lineClean = line.trim()
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

function expandDates(
	dateRaw: string,
	ev: CalendarEvent,
	events: Record<string, CalendarEvent[]>,
	clearExisting = false,
	eventYear: number,
) {
	const originalDateRaw = dateRaw.replace(/\s*a\s*/g, ' a ').replace(
		/\s*e\s*/g,
		' e ',
	).trim()
	dateRaw = dateRaw.replace(/012\/2027/, '1/2/2027')
	dateRaw = dateRaw.replace(/\/\d{4}/g, '')

	const segments = dateRaw.split(/\s*(?:e|,)\s*/)
	const parsedSegments: any[] = segments.map((seg) => {
		const parts = seg.split(/\s*a\s*/)
		if (parts.length === 1) {
			return { type: 'single', d: parseDateStr(parts[0]) }
		} else {
			return {
				type: 'range',
				start: parseDateStr(parts[0]),
				end: parseDateStr(parts[1]),
			}
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
			ev.dateRange = originalDateRaw
			addEvent(p.d, ev, events, clearExisting, eventYear)
		} else if (p.type === 'range' && p.start && p.end) {
			const startD = new Date(eventYear, p.start.month - 1, p.start.day)
			const endD = new Date(eventYear, p.end.month - 1, p.end.day)
			ev.dateRange = originalDateRaw
			for (let d = new Date(startD); d <= endD; d.setDate(d.getDate() + 1)) {
				addEvent(
					{ day: d.getDate(), month: d.getMonth() + 1 },
					ev,
					events,
					clearExisting,
					eventYear,
				)
			}
		}
	}
}

function parseDateStr(s: string) {
	const m = s.trim().match(/^(\d{1,3})(?:\/(\d{1,2}))?/)
	if (!m) return null
	return { day: parseInt(m[1]), month: m[2] ? parseInt(m[2]) : 0 }
}

function addEvent(
	d: { day: number; month: number },
	ev: CalendarEvent,
	events: Record<string, CalendarEvent[]>,
	clearExisting: boolean,
	year: number,
) {
	const key = `${d.day.toString().padStart(2, '0')}/${
		d.month.toString().padStart(2, '0')
	}/${year}`
	if (!events[key]) events[key] = []
	if (clearExisting) events[key] = []

	const exists = events[key].some((e) => e.atividade === ev.atividade)
	if (!exists) {
		events[key].push({ ...ev }) // shallow clone to safely assign different range or just push
	}
}

export async function updateCalendarCache() {
	const year = new Date().getFullYear()
	const { base, resolutions } = await fetchCalendarLinks(year)

	await mkdir('conf/gen/cache', { recursive: true })
	await mkdir('conf/gen/temp', { recursive: true })

	const baseTxtPath = `conf/gen/temp/cal_${year}.txt`
	const baseText = await downloadAndConvertPdf(base, baseTxtPath)

	const events = parseBaseCalendarText(baseText, year)

	for (let i = 0; i < resolutions.length; i++) {
		const resTxtPath = `conf/gen/temp/cal_${year}_res_${i}.txt`
		const resText = await downloadAndConvertPdf(resolutions[i], resTxtPath)
		parseResolutionText(resText, events, year)
	}

	await writeFile(
		`conf/gen/cache/calendar_${year}.json`,
		JSON.stringify(events, null, 2),
	)
	return events
}

// Run as script for testing
const isMain = typeof process !== 'undefined' && process.argv[1] &&
	process.argv[1].endsWith('calendarParser.ts')
if (isMain) {
	updateCalendarCache().then((events) => {
		console.log('Cached successfully. Events:')
		console.log(events['15/07'])
	}).catch(console.error)
}
