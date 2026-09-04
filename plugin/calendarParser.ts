// Parses the UFES academic calendar PDFs (via pdftotext -layout) into per-day
// events. Tables frequently span page breaks: pdftotext repeats the page
// footers/headers mid-table WITHOUT repeating the column header, so the parser
// must keep accumulating rows across those interruptions (only a new month
// calendar or a new column header ends the current batch).
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
				const prevEndsWithContinuation = prevText.trim().match(/[-–,\/]$/) ||
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
				currentBlock.centerIdx = (currentBlock.startIdx + currentBlock.endIdx) /
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

export async function fetchCalendarLinks(
	year: number,
): Promise<{ base: string; resolutions: string[] }> {
	const url = 'https://prograd.ufes.br/calendario'
	// Timeout so a hung portal never wedges the cache update; callers already catch.
	const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
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
				// Only accept PDF files, ignore Google Calendar or external links
				if (link.toLowerCase().includes('.pdf')) {
					if (link.startsWith('/')) link = 'https://prograd.ufes.br' + link
					resolutions.push(link)
				}
			}
		} else if (
			p.trim().length > 0 && !p.includes('rteindent1') && !p.includes('<br')
		) {
			const textContent = p.replace(/<[^>]+>/g, '').trim()
			// Stop if we hit a header, a new year's calendar, or another category
			if (
				textContent.length > 5 ||
				p.includes('<h') ||
				p.includes('Cursos EAD') ||
				p.includes('Anteriores:')
			) {
				break
			}
		}
	}

	return { base: baseLink, resolutions: resolutions.reverse() }
}

async function downloadAndConvertPdf(url: string, destTxt: string) {
	const destPdf = destTxt.replace('.txt', '.pdf')
	// --max-time keeps a stalled download from hanging the daily job forever.
	const curl = new Deno.Command('curl', { args: ['-sL', '--max-time', '60', url, '-o', destPdf] })
	await curl.output()
	const pdf = new Deno.Command('pdftotext', { args: ['-layout', destPdf, destTxt] })
	await pdf.output()
	return await Deno.readTextFile(destTxt)
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
	let rIdx = -1, dIdx = -1, aIdx = -1

	let currentPeriodo = ''
	let currentYear = baseYear

	type TableLine = {
		gPart: string
		rPart: string
		dPart: string
		aPart: string
		periodo: string
		year: number
		// True when the row was read after a mid-table page-break interruption
		// (footers/headers without a repeated column header). Only those
		// continuation rows may inherit an empty grupo cell from the span label
		// above; anywhere else the historical nearest-block behavior is kept.
		afterBreak: boolean
	}
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

		// Rejoin dates split across two text lines ("24 a" + "28/8", "4a" +
		// "6/8", "17 e" + "18/8"). expandDates below treats "a" as a range and
		// "e" as separate days, so both connectors merge the same way here.
		for (let i = 0; i < tableLines.length; i++) {
			if (tableLines[i].dPart.match(/[ae]$/)) {
				for (let j = i + 1; j < tableLines.length; j++) {
					if (tableLines[j].dPart) {
						const center = Math.floor((i + j) / 2)
						tableLines[center].dPart = tableLines[i].dPart.replace(
							/([ae])$/,
							' $1 ',
						) +
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
				// Continuation rows (after a mid-table page break) with an empty
				// grupo cell belong to the vertical span whose label sits above
				// them, so when the nearest label is a far one below (the next
				// span's label) they inherit the nearest label from above.
				// Anywhere else the historical nearest-block behavior is kept.
				if (!tableLines[c].gPart.trim() && tableLines[c].afterBreak) {
					validG.sort((a, b) => Math.abs(a.centerIdx - c) - Math.abs(b.centerIdx - c))
					let picked = validG[0]
					if (picked.centerIdx > c && picked.centerIdx - c > 3) {
						const above = validG
							.filter((b) => b.centerIdx < c)
							.sort((a, b) => b.centerIdx - a.centerIdx)
						if (above.length > 0) picked = above[0]
					}
					assignments[c].g.push(picked)
				} else {
					validG.sort((a, b) => Math.abs(a.centerIdx - c) - Math.abs(b.centerIdx - c))
					if (
						validG.length > 1 &&
						Math.abs(validG[0].centerIdx - c) ===
							Math.abs(validG[1].centerIdx - c)
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
					Math.abs(validR[0].centerIdx - c) ===
						Math.abs(validR[1].centerIdx - c)
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
			const localG = assignment.g.map((b: TextBlock) =>
				b.lines.join(' ').replace(/\s+/g, ' ').trim()
			).join(' ').trim()
			const localR = assignment.r.map((b: TextBlock) =>
				b.lines.join(' ').replace(/\s+/g, ' ').trim()
			).join(' ').trim()
			const fullAtiv = assignment.a.map((b: TextBlock) =>
				b.lines.join(' ').replace(/\s+/g, ' ').trim()
			).join(' ').trim()

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
		batchCrossedBreak = false
	}

	for (const line of lines) {
		const lineClean = line.replace(/\r/g, '').replace(
			/\bPprofessor\b/g,
			'Professor',
		).trimEnd()

		// Page footers/headers (*Data, **PA, UNIVERSIDADE, CONSELHO, ESTA
		// RESOLUÇÃO...) interrupt tables in pdftotext -layout output, but the
		// table continues on the next page without a repeated column header.
		// They are skipped WITHOUT flushing so continuation rows stay in the same
		// batch (preserving vertically-spanned grupo cells). Only a month calendar
		// (Dias Letivos) or a new column header below ends the current batch.
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

		// Month calendars whose header wraps onto two text lines leave a bare
		// "Dias Letivos: ..." line without the MONTH/YYYY part. It must also end
		// the current batch, otherwise it is captured as a table row.
		if (lineClean.toLowerCase().includes('dias letivos')) {
			processTableLines()
			inTable = false
			continue
		}

		if (
			lineClean.includes('Grupo de atividades') &&
			lineClean.includes('Atividade') && lineClean.includes('Data')
		) {
			processTableLines()
			inTable = true
			rIdx = lineClean.indexOf('Responsável')
			dIdx = lineClean.indexOf('Data')
			aIdx = lineClean.indexOf('Atividade')
			continue
		}

		if (inTable && dIdx !== -1 && aIdx !== -1) {
			// Only the date/activity boundary follows the drifting date column.
			// The grupo boundary stays fixed at the header column: shifting it
			// rightwards would swallow responsavel text (e.g. "PA**") into the
			// grupo slice. Shifting it leftwards is still needed for rows that
			// start left of the header column.
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

			// Date fragments stranded in rPart on short date-only lines ("4a"
			// for "4 a 6/8"): with no direct date match there is no column
			// shift, so the fixed slice leaves them left of the date column.
			// Move them back to dPart so the split-date merge below can see them.
			if (!dPart && rPart.match(/^\d{1,2}(?:\/\d{1,2})?\s*[ae]$/)) {
				dPart = rPart
				rPart = ''
			}

			// The fixed-width slice can swallow activity words into dPart when a
			// row starts its activity left of the header column (e.g. "22 a 26/2
			// Matrícula ... Refugiados 2027/1"). Keep only the leading date
			// portion and push the remainder back to the activity.
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

function findSplitIndex(line: string, hint: number, preferLeft = false): number {
	if (hint <= 0 || hint >= line.length) return hint
	// Grupo boundary: a hint landing inside a word means the responsavel starts
	// left of the header column, so the word belongs to the right side.
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

		const cleanStr = currentEventLines.join(' ')
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

function expandDates(
	dateRaw: string,
	ev: CalendarEvent,
	events: Record<string, CalendarEvent[]>,
	clearExisting = false,
	eventYear: number,
	isExclusion = false,
) {
	// Normalize only connectors between digits so activity words that leaked
	// into dateRaw can never be mangled (previous /\s*a\s*/g spaced every "a",
	// turning "Matrícula" into "M a trícul a").
	const originalDateRaw = dateRaw
		.replace(/(\d)\s*a\s*(?=\d|$)/g, '$1 a ')
		.replace(/(\d)\s*e\s*(?=\d|$)/g, '$1 e ')
		.replace(/\s+/g, ' ')
		.trim()
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

function normalizeDatePart(dPart: string): string {
	// pdftotext -layout sometimes collapses "28/7 a" into "287 a" (lost slash).
	// Restore it when the 3 digits hold a valid day+month without one.
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

function parseDateStr(s: string) {
	const m = s.trim().match(/^(\d{1,2})(?!\d)(?:\/(\d{1,2})(?!\d))?/)
	if (!m) return null
	const day = parseInt(m[1])
	const month = m[2] ? parseInt(m[2]) : 0
	if (day < 1 || day > 31) return null
	if (month < 0 || month > 12) return null
	return { day, month }
}

export function normalizeActivity(s: string): string {
	return s
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '') // remove accents
		.replace(/[^a-z0-9]/g, '') // remove punctuation, spaces, dots, commas
		.trim()
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

function addEvent(
	d: { day: number; month: number },
	ev: CalendarEvent,
	events: Record<string, CalendarEvent[]>,
	clearExisting: boolean,
	year: number,
	isExclusion = false,
) {
	// Defense in depth: never emit month-less or out-of-range keys (previously
	// produced entries like 17/00/2026 or overflowed dates such as day 287).
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
		if (!existing.dateRange && ev.dateRange) {
			existing.dateRange = ev.dateRange
		}
		if (!existing.grupo && ev.grupo) {
			existing.grupo = ev.grupo
		}
		if (!existing.responsavel && ev.responsavel) {
			existing.responsavel = ev.responsavel
		}
		// Prefer the longer/more complete version
		if (
			ev.atividade.length > existing.atividade.length && !existing.atividade.includes('...')
		) {
			existing.atividade = ev.atividade
		}
	} else {
		events[key].push({ ...ev })
	}
}

export async function updateCalendarCache() {
	const year = new Date().getFullYear()
	const { base, resolutions } = await fetchCalendarLinks(year)

	await Deno.mkdir('conf/gen/cache', { recursive: true })
	await Deno.mkdir('conf/gen/temp', { recursive: true })

	const baseTxtPath = `conf/gen/temp/cal_${year}.txt`
	const baseText = await downloadAndConvertPdf(base, baseTxtPath)

	const events = parseBaseCalendarText(baseText, year)

	for (let i = 0; i < resolutions.length; i++) {
		const resTxtPath = `conf/gen/temp/cal_${year}_res_${i}.txt`
		const resText = await downloadAndConvertPdf(resolutions[i], resTxtPath)
		parseResolutionText(resText, events, year)
	}

	await Deno.writeTextFile(
		`conf/gen/cache/calendar_${year}.json`,
		JSON.stringify(events, null, 2),
	)
	return events
}

// Run as script for testing
const isMain = import.meta.main
if (isMain) {
	updateCalendarCache().then((events) => {
		console.log('Cached successfully. Events:')
		console.log(events['15/07'])
	}).catch(console.error)
}
