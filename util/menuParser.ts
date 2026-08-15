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
		items: string[]
		rawBlock: string
	}
	lunch?: MealDetails
	dinner?: MealDetails
	rawFullText: string
}

const regexFood =
	/(CAFÉ DA MANHÃ|ALMOÇO|JANTAR)[\s\S]*?<div class="field-content">([\s\S]*?)<\/div>/gi
const regexTags = /<[^>]*>?/gm

const titles = [
	'Prato Principal',
	'Opção',
	'Guarnição',
	'Acompanhamentos',
	'Acompanhamento',
	'Saladas',
	'Sobremesa',
	'Suco',
	'Desjejum',
	'Leite',
	'Fruta',
	'Café',
]

const Hours: Record<string, string> = {
	'CAFÉ DA MANHÃ': '7h – 8h',
	ALMOÇO: '11h – 13h30',
	JANTAR: '17h – 19h',
}

const MealEmojis: Record<string, string> = {
	'CAFÉ DA MANHÃ': '☕',
	ALMOÇO: '🍛',
	JANTAR: '🍲',
}

export function parseMenuHtml(html: string): ParsedMenuResult {
	const result: ParsedMenuResult = {
		hasMenu: false,
		rawFullText: '',
	}

	const blocks: string[] = []

	for (const match of html.matchAll(regexFood)) {
		const meal = match[1].toUpperCase() as keyof typeof Hours
		const lines = match[2]
			.replace(regexTags, '\n')
			.split('\n')
			.map((item) => item.trim())
			.filter((item) => item.length > 2 && !item.includes('*O cardápio poderá sofrer'))

		if (lines.length === 0) continue
		result.hasMenu = true

		if (meal === 'CAFÉ DA MANHÃ') {
			const items: string[] = []
			let currentTitle = ''
			let fruit = ''
			let juice = ''
			for (const line of lines) {
				if (titles.includes(line)) {
					currentTitle = line
				} else {
					if (currentTitle === 'Fruta') {
						fruit = line
						items.push(`*Fruta:* ${line}`)
					} else if (currentTitle === 'Suco') {
						juice = line
						items.push(`*Suco:* ${line}`)
					} else if (currentTitle === 'Café' || currentTitle === 'Leite') {
						const lowerLine = line.toLowerCase()
						if (lowerLine.includes(currentTitle.toLowerCase())) {
							items.push(line)
						} else {
							items.push(`${currentTitle} ${lowerLine}`)
						}
					} else {
						items.push(line)
					}
				}
			}

			const rawBlock = `> ${MealEmojis[meal] || '☕'} *Café da Manhã (${
				Hours[meal] || '7h – 8h'
			})*\n• ${items.join(', ')}`
			result.breakfast = { fruit, juice, items, rawBlock }
			blocks.push(rawBlock)
		} else {
			const mealDetails: MealDetails = { rawBlock: '' }
			const sectionLines: string[] = []
			const itemsByTitle: Record<string, string[]> = {}
			let currentTitle = ''

			for (const line of lines) {
				if (titles.includes(line)) {
					currentTitle = line
					if (!itemsByTitle[currentTitle]) itemsByTitle[currentTitle] = []
				} else {
					const t = currentTitle || 'Outros'
					if (!itemsByTitle[t]) itemsByTitle[t] = []
					itemsByTitle[t].push(line)
				}
			}

			if (itemsByTitle['Prato Principal']) {
				mealDetails.mainDish = itemsByTitle['Prato Principal'].join(', ')
			}
			if (itemsByTitle['Opção']) {
				mealDetails.optionDish = itemsByTitle['Opção'].join(', ')
			}
			if (itemsByTitle['Saladas']) {
				mealDetails.salads = itemsByTitle['Saladas']
					.map((s) => s.replace(/^Salada de\s+/i, ''))
					.join(' e ')
			}
			if (itemsByTitle['Sobremesa']) {
				mealDetails.dessert = itemsByTitle['Sobremesa'].join(', ')
			}
			if (itemsByTitle['Suco']) {
				mealDetails.juice = itemsByTitle['Suco'].join(', ')
			}
			if (itemsByTitle['Guarnição']) {
				mealDetails.sideDish = itemsByTitle['Guarnição'].join(', ')
			} else if (itemsByTitle['Acompanhamento']) {
				mealDetails.sideDish = itemsByTitle['Acompanhamento'].join(', ')
			}

			for (const t of titles) {
				if (itemsByTitle[t] && itemsByTitle[t].length > 0) {
					if (itemsByTitle[t].length === 1) {
						sectionLines.push(`• *${t}:* ${itemsByTitle[t][0]}`)
					} else {
						sectionLines.push(`• *${t}:* ${itemsByTitle[t].join(' / ')}`)
					}
				}
			}
			if (itemsByTitle['Outros'] && itemsByTitle['Outros'].length > 0) {
				for (const item of itemsByTitle['Outros']) {
					sectionLines.push(`• ${item}`)
				}
			}

			const mealName = meal === 'ALMOÇO' ? 'Almoço' : 'Jantar'
			const rawBlock =
				`> ${MealEmojis[meal] || '🍽️'} *${mealName} (${Hours[meal] || ''})*\n` +
				sectionLines.join('\n')

			mealDetails.rawBlock = rawBlock

			if (meal === 'ALMOÇO') {
				result.lunch = mealDetails
			} else if (meal === 'JANTAR') {
				result.dinner = mealDetails
			}

			blocks.push(rawBlock)
		}
	}

	result.rawFullText = blocks.join('\n\n')
	return result
}
