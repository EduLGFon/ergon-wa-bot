// menuSelection tests - HTML/RSS pick rules plus retry and scoring behavior
import { chooseMenu, menuScore, shouldRetry } from '@util/menuSelection.ts'
import { type ParsedMenuResult } from '@util/menuParser.ts'
import { ok, strictEqual } from 'node:assert/strict'

function thinLunch(): ParsedMenuResult {
	return {
		hasMenu: true,
		rawFullText: 'thin',
		lunch: { mainDish: 'Frango', rawBlock: 'thin' },
	}
}

function fullLunch(): ParsedMenuResult {
	return {
		hasMenu: true,
		rawFullText: 'full',
		lunch: {
			mainDish: 'Frango',
			optionDish: 'Ovos',
			sideDish: 'Arroz',
			salads: 'Alface',
			dessert: 'Melancia',
			juice: 'Maracuja',
			rawBlock: 'full',
		},
	}
}

Deno.test('menuSelection: html wins ties', () => {
	const html = thinLunch()
	const rss = thinLunch()
	const picked = chooseMenu(html, rss)
	strictEqual(picked.source, 'html')
	strictEqual(picked.menu, html)
})

Deno.test('menuSelection: html wins when more complete', () => {
	const html = fullLunch()
	const rss = thinLunch()
	const picked = chooseMenu(html, rss)
	strictEqual(picked.source, 'html')
	strictEqual(picked.menu, html)
})

Deno.test('menuSelection: rss wins when html is missing', () => {
	const rss = thinLunch()
	const picked = chooseMenu(null, rss)
	strictEqual(picked.source, 'rss')
	strictEqual(picked.menu, rss)
})

Deno.test('menuSelection: rss wins when more complete', () => {
	const html = thinLunch()
	const rss = fullLunch()
	const picked = chooseMenu(html, rss)
	strictEqual(picked.source, 'rss')
	strictEqual(picked.menu, rss)
})

Deno.test('menuSelection: no retry when both sources answered without a menu', () => {
	strictEqual(shouldRetry(true, true, null), false)
	strictEqual(
		shouldRetry(true, true, { hasMenu: false, rawFullText: '' }),
		false,
	)
	strictEqual(shouldRetry(true, true, thinLunch()), false)
})

Deno.test('menuSelection: retry when a source failed without a menu', () => {
	strictEqual(shouldRetry(false, true, null), true)
	strictEqual(shouldRetry(true, false, null), true)
	strictEqual(shouldRetry(false, false, null), true)
})

Deno.test('menuSelection: score rewards structured fields', () => {
	strictEqual(menuScore(null), -1)
	strictEqual(menuScore({ hasMenu: false, rawFullText: '' }), -1)
	ok(menuScore(fullLunch()) > menuScore(thinLunch()))
	const withDinner: ParsedMenuResult = {
		...thinLunch(),
		dinner: { mainDish: 'Lombo', rawBlock: 'dinner' },
	}
	ok(menuScore(withDinner) > menuScore(thinLunch()))
	const withBreakfast: ParsedMenuResult = {
		...thinLunch(),
		breakfast: { items: ['Pao'], rawBlock: 'breakfast' },
	}
	ok(menuScore(withBreakfast) > menuScore(thinLunch()))
})
