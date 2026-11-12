// menuSelection - pure source-selection helpers for the RU menu scrape
// - scores parsed menus by completeness so HTML and RSS picks stay testable
import { type ParsedMenuResult } from '@util/menuParser.ts'

export function menuScore(menu: ParsedMenuResult | null): number {
	if (!menu?.hasMenu) return -1
	let score = 0
	if (menu.breakfast) score += menu.breakfast.items.length > 0 ? 2 : 0
	for (const meal of [menu.lunch, menu.dinner]) {
		if (!meal) continue
		score += 2
		for (
			const field of [
				meal.mainDish,
				meal.optionDish,
				meal.sideDish,
				meal.salads,
				meal.dessert,
				meal.juice,
			]
		) {
			if (field) score += 1
		}
	}
	return score
}

export function chooseMenu(
	html: ParsedMenuResult | null,
	rss: ParsedMenuResult | null,
): { menu: ParsedMenuResult | null; source: 'html' | 'rss' } {
	if (menuScore(rss) > menuScore(html)) return { menu: rss, source: 'rss' }
	return { menu: html, source: 'html' }
}

export function shouldRetry(
	htmlFulfilled: boolean,
	rssFulfilled: boolean,
	best: ParsedMenuResult | null,
): boolean {
	if (best?.hasMenu) return false
	if (htmlFulfilled && rssFulfilled) return false
	return true
}
