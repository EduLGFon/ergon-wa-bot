// Daily summary builder: composes the deterministic morning bulletin (weather + RU menu + calendar).
// Gemini was removed after 100% failure in prod (503 overloaded + timeouts); this file is fallback-only now.
import { type ClassifiedCalendar } from '@util/calendarAnalytics.ts'
import { getNextBulletinTitle } from '@util/bulletinTitles.ts'
import { type ParsedMenuResult } from '@util/menuParser.ts'
import { type WeatherReport } from '@util/weather.ts'

export interface DailySummaryInput {
	dateStr: string
	weather: WeatherReport | null
	menu: ParsedMenuResult | null
	calendar: ClassifiedCalendar | null
	bulletinTitle?: string
	campusName?: string
}

export async function generateDailySummary(
	input: DailySummaryInput,
): Promise<string> {
	if (!input.bulletinTitle) {
		input.bulletinTitle = await getNextBulletinTitle()
	}

	// Deterministic-only: Gemini path removed (prod showed 15/15 failures).
	// Keep the async shape so callers do not need to change.
	return generateFallbackSummary(input)
}

function formatHeaderTitle(raw: string): string {
	const t = raw.trim()
	if (t.includes('*')) return t
	const match = t.match(
		/^([\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Regional_Indicator}\u200D\uFE0F\u2600-\u27BF\uE000-\uF8FF\s]+)(.*)$/u,
	)
	if (match && match[2].trim()) {
		return `${match[1].trim()} *${match[2].trim()}*`
	}
	return `*${t}*`
}

function formatBreakfastLine(b: NonNullable<ParsedMenuResult['breakfast']>): string {
	const parts: string[] = []
	if (b.bread) parts.push(`🍞 ${b.bread}`)
	if (b.milk) parts.push('🥛')
	if (b.coffee) parts.push('☕')
	if (b.fruit) parts.push(b.fruit)
	if (b.juice) parts.push(`suco de ${b.juice}`)
	if (parts.length === 0) return ''
	if (parts.length === 1) return parts[0]
	return `${parts.slice(0, -1).join(', ')} e ${parts[parts.length - 1]}`
}

function pushSubItemLines(menuLines: string[], subItems: string[]) {
	for (const item of subItems) menuLines.push(`   ↳ _${item}_`)
}

export function generateFallbackSummary(input: DailySummaryInput): string {
	const headerTitle = formatHeaderTitle(input.bulletinTitle || '🧠 *Boletim CEUNES*')
	const sections: string[] = []

	// 1. Header (No weekday, simple hyphen)
	sections.push(`${headerTitle} - *${input.dateStr}*`)

	// 2. Weather
	if (input.weather) {
		sections.push(input.weather.formattedLine)
	}

	// 3. Menu (Option 2 compact format)
	const menuLines: string[] = ['🍽️ *Cardápio do RU:*']
	if (input.menu && input.menu.hasMenu) {
		if (input.menu.breakfast) {
			const bLine = formatBreakfastLine(input.menu.breakfast)
			if (bLine) {
				menuLines.push(`☕ *Café:* ${bLine}`)
			}
		}

		if (input.menu.lunch) {
			let lunchMain = `🍛 *Almoço:* ${input.menu.lunch.mainDish || 'Prato do dia'}`
			if (input.menu.lunch.optionDish) {
				lunchMain += ` _(Opção: ${input.menu.lunch.optionDish})_`
			}
			menuLines.push(lunchMain)

			const subItems = []
			if (input.menu.lunch.sideDish) subItems.push(input.menu.lunch.sideDish)
			if (input.menu.lunch.salads) subItems.push(`Saladas: ${input.menu.lunch.salads}`)
			if (input.menu.lunch.dessert) subItems.push(input.menu.lunch.dessert)
			if (input.menu.lunch.juice) subItems.push(`Suco de ${input.menu.lunch.juice}`)
			pushSubItemLines(menuLines, subItems)
		}

		if (input.menu.dinner) {
			let dinnerMain = `🍲 *Jantar:* ${input.menu.dinner.mainDish || 'Prato do dia'}`
			if (input.menu.dinner.optionDish) {
				dinnerMain += ` _(Opção: ${input.menu.dinner.optionDish})_`
			}
			menuLines.push(dinnerMain)

			const subItems = []
			if (input.menu.dinner.sideDish) subItems.push(input.menu.dinner.sideDish)
			if (input.menu.dinner.salads) subItems.push(`Saladas: ${input.menu.dinner.salads}`)
			if (input.menu.dinner.dessert) subItems.push(input.menu.dinner.dessert)
			if (input.menu.dinner.juice) subItems.push(`Suco de ${input.menu.dinner.juice}`)
			pushSubItemLines(menuLines, subItems)
		}
	} else {
		menuLines.push(
			`  • _Cardápio ainda não divulgado (ou RU fechado). Se for publicado mais tarde, enviaremos a atualização aqui!_`,
		)
	}
	sections.push(menuLines.join('\n'))

	// 4. Calendar (Option 2 compact format)
	if (input.calendar && input.calendar.hasEvents) {
		const calLines: string[] = ['🎓 *Calendário Acadêmico:*']

		if (input.calendar.newStudentEvents.length > 0) {
			for (const e of input.calendar.newStudentEvents) {
				const deadline = e.dateRange ? ` *(até ${getEndDate(e.dateRange)})*` : ''
				calLines.push(`  🚨 *Estudante (Novo hoje):* ${e.atividade}${deadline}`)
			}
		} else {
			calLines.push(`  • _Nada de novo em relação a ontem._`)
		}

		if (input.calendar.endingTodayEvents.length > 0) {
			const endingNames = input.calendar.endingTodayEvents.map((e) => {
				const who = e.responsavel ? ` _(${e.responsavel})_` : ''
				return `${e.atividade}${who}`
			}).join('; ')
			calLines.push(`  ⏳ *Último dia hoje:* ${endingNames}`)
		}

		if (input.calendar.ongoingStudentEvents.length > 0) {
			for (const e of input.calendar.ongoingStudentEvents) {
				const deadline = e.dateRange ? ` *(até ${getEndDate(e.dateRange)})*` : ''
				calLines.push(`  📌 *Em andamento:* ${e.atividade}${deadline}`)
			}
		}

		sections.push(calLines.join('\n'))
	}

	// Single line break between title and weather line, double elsewhere
	if (input.weather && sections.length > 1) {
		return `${sections[0]}\n${sections.slice(1).join('\n\n')}`
	}
	return sections.join('\n\n')
}

function getEndDate(dateRange: string): string {
	const parts = dateRange.split(/\s+a\s+/)
	if (parts.length > 1) {
		return parts[1].trim()
	}
	return dateRange.trim()
}
