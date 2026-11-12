// menuParser - parse RU HTML menu into structured meals
// - meal blocks are found by their headings, not by CSS classes, so template
//   changes (wrappers, classes, paragraph -> list markup) do not break parsing
// - section headings are normalized (case, accents, punctuation) and unknown
//   bold headings are kept as custom sections instead of being dropped
// - parseMenuRss reads the site's RSS feed, used as a fallback source
export interface MealDetails {
	mainDish?: string
	optionDish?: string
	sideDish?: string
	salads?: string
	dessert?: string
	juice?: string
	rawBlock: string
}

export interface ParsedMenuResult {
	hasMenu: boolean
	breakfast?: {
		fruit?: string
		juice?: string
		bread?: string
		milk?: string
		coffee?: string
		items: string[]
		rawBlock: string
	}
	lunch?: MealDetails
	dinner?: MealDetails
	rawFullText: string
}

type MealKey = 'breakfast' | 'lunch' | 'dinner'

interface MealInfo {
	name: string
	emoji: string
	hours: string
}

const HEADING_OPEN = '\u0001'
const HEADING_CLOSE = '\u0002'

const MEALS: Record<MealKey, MealInfo> = {
	breakfast: { name: 'Café da Manhã', emoji: '☕', hours: '7h - 8h' },
	lunch: { name: 'Almoço', emoji: '🍛', hours: '11h - 13h30' },
	dinner: { name: 'Jantar', emoji: '🍲', hours: '17h - 19h' },
}
const MEAL_ORDER: MealKey[] = ['breakfast', 'lunch', 'dinner']

// Map normalized labels to the canonical section names used by this parser.
// Add aliases here when the site renames a heading; unknown bold headings are
// still preserved as custom sections.
const titleAliases: Record<string, string> = {
	'prato principal': 'Prato Principal',
	'prato do dia': 'Prato Principal',
	'prato proteico': 'Prato Principal',
	opcao: 'Opção',
	'opcao vegetariana': 'Opção',
	guarnicao: 'Guarnição',
	acompanhamento: 'Acompanhamentos',
	acompanhamentos: 'Acompanhamentos',
	salada: 'Saladas',
	saladas: 'Saladas',
	sobremesa: 'Sobremesa',
	sobremesas: 'Sobremesa',
	suco: 'Suco',
	sucos: 'Suco',
	desjejum: 'Desjejum',
	leite: 'Leite',
	fruta: 'Fruta',
	frutas: 'Fruta',
	cafe: 'Café',
}
const knownSections = new Set(Object.values(titleAliases))

const entities: Record<string, string> = {
	nbsp: ' ',
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	laquo: '«',
	raquo: '»',
	ndash: '–',
	mdash: '—',
	hellip: '…',
	deg: '°',
	ordm: 'º',
	ordf: 'ª',
	copy: '©',
	reg: '®',
	aacute: 'á',
	agrave: 'à',
	acirc: 'â',
	atilde: 'ã',
	eacute: 'é',
	ecirc: 'ê',
	iacute: 'í',
	oacute: 'ó',
	ocirc: 'ô',
	otilde: 'õ',
	uacute: 'ú',
	ccedil: 'ç',
}

function decodeEntities(text: string): string {
	return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code: string) => {
		if (code.startsWith('#')) {
			const hex = code[1]?.toLowerCase() === 'x'
			const num = parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10)
			return num >= 0 && num <= 0x10ffff ? String.fromCodePoint(num) : match
		}
		return entities[code.toLowerCase()] ?? match
	})
}

function stripMarkers(text: string): string {
	return text.replaceAll(HEADING_OPEN, '').replaceAll(HEADING_CLOSE, '')
}

function cleanText(text: string): string {
	return stripMarkers(text).replace(/\s+/g, ' ').trim()
}

function normalizeText(text: string): string {
	return cleanText(text)
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim()
}

// Strip tags without inventing line breaks inside words: the site sometimes
// splits a heading like "Prato Principal" across inline tags. Bold/heading
// markers let us keep section boundaries even when the label itself changes.
function htmlToLines(html: string): string[] {
	const marked = html
		.replace(/<(strong|b|h[1-6])\b[^>]*>/gi, HEADING_OPEN)
		.replace(/<\/(strong|b|h[1-6])\s*>/gi, HEADING_CLOSE)
		.replace(/<br\b[^>]*\/?>/gi, '\n')
		.replace(
			/<\/(?:p|div|li|dt|dd|h[1-6]|tr|td|th|table|ul|ol|section|article|header|footer)>/gi,
			'\n',
		)
		.replace(
			/<(?:p|div|li|dt|dd|h[1-6]|tr|td|th|table|ul|ol|section|article|header|footer)\b[^>]*>/gi,
			'\n',
		)
		.replace(/<[^>]*>/g, '')

	return decodeEntities(marked)
		.split(/\r?\n/)
		.map((line) => line.replace(/\s+/g, ' ').trim())
		.filter((line) => stripMarkers(line).length > 0)
}

// Meal titles are headings in the page title area (not item labels). Requiring
// the meal name at the start avoids matching a food item that contains "Jantar".
function detectMeal(line: string): MealKey | undefined {
	const text = normalizeText(line)
	if (text.startsWith('cafe da manha')) return 'breakfast'
	if (text.startsWith('almoco')) return 'lunch'
	if (text.startsWith('jantar')) return 'dinner'
}

function isDisclaimer(line: string): boolean {
	const text = normalizeText(line)
	return text.includes('cardapio podera sofrer')
}

function isChromeLine(line: string): boolean {
	const text = normalizeText(line)
	if (!text) return true
	if (
		/^(cardapio|calendario|calendario academico|adicionar ao meu calendario|voltar ao topo)$/
			.test(text)
	) return true
	if (/^(dom|seg|ter|qua|qui|sex|sab)$/.test(text)) return true
	if (/^\d{1,2}$/.test(text)) return true
	if (
		/^(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)( \d{4})?$/
			.test(text)
	) return true
	if (/^(laquo|raquo|nbsp)$/.test(text)) return true
	return false
}

function headingFromLine(raw: string): string | undefined {
	const text = cleanText(raw)
	if (!text || isDisclaimer(text) || isChromeLine(text)) return undefined

	const alias = titleAliases[normalizeText(text)]
	if (alias) return alias

	// Unknown headings are only accepted when they were bold/heading markup and
	// look like a label, not like a full dish description.
	const trimmed = raw.trimStart()
	const startsMarked = trimmed.startsWith(HEADING_OPEN) ||
		trimmed.replace(/^[•*\-–—]+\s*/, '').startsWith(HEADING_OPEN)
	if (!startsMarked) return undefined
	if (text.length > 60 || text.split(/\s+/).length > 6) return undefined
	return text.replace(/[\s:：.\-–—]+$/, '')
}

interface BodyEntry {
	title?: string
	text: string
}

function parseBody(lines: string[]): BodyEntry[] {
	const entries: BodyEntry[] = []
	let currentTitle: string | undefined

	for (const raw of lines) {
		if (isDisclaimer(raw) || isChromeLine(raw)) continue
		const text = cleanText(raw)
		if (!text) continue

		const heading = headingFromLine(raw)
		if (heading) {
			currentTitle = heading
			continue
		}

		entries.push({ title: currentTitle, text })
	}

	return entries
}

function scoreBody(entries: BodyEntry[]): number {
	const sections = new Set<string>()
	for (const entry of entries) {
		if (entry.title && knownSections.has(entry.title)) {
			sections.add(entry.title)
		}
	}
	return entries.length + sections.size * 5
}

function collectSegments(lines: string[]): Map<MealKey, string[][]> {
	const segments = new Map<MealKey, string[][]>()
	let current: { key: MealKey; lines: string[] } | null = null

	const flush = () => {
		if (!current) return
		const list = segments.get(current.key) ?? []
		list.push(current.lines)
		segments.set(current.key, list)
		current = null
	}

	for (const line of lines) {
		const meal = detectMeal(line)
		if (meal) {
			flush()
			current = { key: meal, lines: [] }
			continue
		}
		if (!current) continue
		if (isDisclaimer(line) || isChromeLine(line)) {
			flush()
			continue
		}
		current.lines.push(line)
	}

	flush()
	return segments
}

function pickBestBody(segments: string[][]): BodyEntry[] {
	let best: BodyEntry[] = []
	let bestScore = 0
	for (const lines of segments) {
		const entries = parseBody(lines)
		const score = scoreBody(entries)
		if (score > bestScore) {
			best = entries
			bestScore = score
		}
	}
	return best
}

function groupEntries(entries: BodyEntry[]): Map<string, string[]> {
	const grouped = new Map<string, string[]>()
	for (const entry of entries) {
		if (!entry.title) continue
		const items = grouped.get(entry.title) ?? []
		items.push(entry.text)
		grouped.set(entry.title, items)
	}
	return grouped
}

function shortenBreadType(line: string): string {
	const text = line.trim()
	const cleaned = text.replace(/^(p[ãa]o|p[ãa]es|desjejum)\s+/i, '').trim() ||
		text
	return cleaned.toLowerCase()
}

function buildBreakfast(
	entries: BodyEntry[],
): ParsedMenuResult['breakfast'] | undefined {
	const items: string[] = []
	let fruit = ''
	let juice = ''
	let bread = ''
	let milk = ''
	let coffee = ''

	for (const entry of entries) {
		const { title, text } = entry
		if (title === 'Fruta') {
			fruit = text
			items.push(`*Fruta:* ${text}`)
		} else if (title === 'Suco') {
			juice = text
			items.push(`*Suco:* ${text}`)
		} else if (title === 'Desjejum') {
			bread = shortenBreadType(text)
			items.push(text)
		} else if (title === 'Leite') {
			milk = text
			const lower = text.toLowerCase()
			items.push(lower.includes('leite') ? text : `Leite ${lower}`)
		} else if (title === 'Café') {
			coffee = text
			const lower = text.toLowerCase()
			items.push(
				lower.includes('café') || lower.includes('cafe') ? text : `Café ${lower}`,
			)
		} else {
			items.push(text)
		}
	}

	if (items.length === 0) return undefined
	const info = MEALS.breakfast
	const rawBlock = `> ${info.emoji} *${info.name} (${info.hours})*\n• ${items.join(', ')}`
	return { fruit, juice, bread, milk, coffee, items, rawBlock }
}

function joinItems(items: string[] | undefined): string | undefined {
	if (!items || items.length === 0) return undefined
	return items.join(', ')
}

function buildMeal(
	key: MealKey,
	entries: BodyEntry[],
): MealDetails | undefined {
	const grouped = groupEntries(entries)
	const info = MEALS[key]

	const sections: string[] = []
	for (const [title, items] of grouped) {
		if (items.length === 0) continue
		sections.push(`• *${title}:* ${items.join(' / ')}`)
	}
	for (const entry of entries) {
		if (!entry.title) sections.push(`• ${entry.text}`)
	}
	if (sections.length === 0) return undefined

	const salads = grouped.get('Saladas')
		?.map((item) => item.replace(/^Salada de\s+/i, ''))
		.join(' e ')

	const rawBlock = `> ${info.emoji} *${info.name} (${info.hours})*\n${sections.join('\n')}`
	return {
		mainDish: joinItems(grouped.get('Prato Principal')),
		optionDish: joinItems(grouped.get('Opção')),
		sideDish: joinItems(
			grouped.get('Guarnição') ?? grouped.get('Acompanhamentos'),
		),
		salads,
		dessert: joinItems(grouped.get('Sobremesa')),
		juice: joinItems(grouped.get('Suco')),
		rawBlock,
	}
}

function buildMenu(segments: Map<MealKey, string[][]>): ParsedMenuResult {
	const result: ParsedMenuResult = { hasMenu: false, rawFullText: '' }
	const blocks: string[] = []

	for (const key of MEAL_ORDER) {
		const entries = pickBestBody(segments.get(key) ?? [])
		if (entries.length === 0) continue

		if (key === 'breakfast') {
			const breakfast = buildBreakfast(entries)
			if (!breakfast) continue
			result.breakfast = breakfast
			blocks.push(breakfast.rawBlock)
		} else {
			const meal = buildMeal(key, entries)
			if (!meal) continue
			if (key === 'lunch') result.lunch = meal
			else result.dinner = meal
			blocks.push(meal.rawBlock)
		}
		result.hasMenu = true
	}

	result.rawFullText = blocks.join('\n\n')
	return result
}

export function parseMenuHtml(html: string): ParsedMenuResult {
	return buildMenu(collectSegments(htmlToLines(html)))
}

function extractTag(xml: string, tag: string): string {
	const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(
		xml,
	)
	if (!match) return ''
	return match[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1')
}

export function parseMenuRss(xml: string): ParsedMenuResult {
	const segments = new Map<MealKey, string[][]>()

	for (const match of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
		const item = match[1]
		const title = htmlToLines(extractTag(item, 'title')).join(' ')
		const description = extractTag(item, 'description')
		const meal = detectMeal(title)
		if (!meal) continue

		const lines = htmlToLines(description)
		if (lines.length === 0) continue
		const list = segments.get(meal) ?? []
		list.push(lines)
		segments.set(meal, list)
	}

	return buildMenu(segments)
}
