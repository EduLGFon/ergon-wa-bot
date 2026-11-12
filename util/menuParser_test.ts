import { parseMenuHtml, parseMenuRss } from '@util/menuParser.ts'
import { ok, strictEqual } from 'node:assert/strict'

const disclaimer = '<p>*O cardápio poderá sofrer alterações sem comunicação prévia</p>'

function card(title: string, body: string): string {
	return `<div class="views-field-title"><span class="field-content">${title}</span></div>
		<div class="views-field-body"><div class="field-content">${body}${disclaimer}</div></div>`
}

Deno.test('menuParser: keeps a heading split across inline tags', () => {
	const menu = parseMenuHtml(
		card(
			'ALMOÇO - qui, 12/11/2026',
			`<p><strong>Prato Principa</strong>l</p><p>Carne de panela</p>
			<p><strong>Opção</strong></p><p>Lentilha chinesa</p>
			<p><strong>Sobremesa</strong></p><p>Melancia</p>`,
		),
	)

	strictEqual(menu.hasMenu, true)
	strictEqual(menu.lunch?.mainDish, 'Carne de panela')
	strictEqual(menu.lunch?.optionDish, 'Lentilha chinesa')
	strictEqual(menu.lunch?.dessert, 'Melancia')
})

Deno.test('menuParser: survives class, wrapper and paragraph-to-list changes', () => {
	const menu = parseMenuHtml(
		`<div>ALMOÇO</div>
		<ul>
			<li><b>Prato Principal</b></li><li>Frango acebolado</li>
			<li><b>Opção</b></li><li>Quibe de abóbora</li>
			<li><b>Guarnição</b></li><li>Polenta</li>
		</ul>`,
	)

	strictEqual(menu.lunch?.mainDish, 'Frango acebolado')
	strictEqual(menu.lunch?.optionDish, 'Quibe de abóbora')
	strictEqual(menu.lunch?.sideDish, 'Polenta')
})

Deno.test('menuParser: normalizes heading case, accents and punctuation', () => {
	const menu = parseMenuHtml(
		card(
			'almoco',
			`<p><strong>PRATO PRINCIPAL:</strong></p><p>Picanha</p>
			<p><strong>guarnicao</strong></p><p>Arroz</p>
			<p><strong>Acompanhamento</strong></p><p>Feijão</p>`,
		),
	)

	strictEqual(menu.lunch?.mainDish, 'Picanha')
	strictEqual(menu.lunch?.sideDish, 'Arroz')
	ok(menu.lunch?.rawBlock.includes('*Acompanhamentos:* Feijão'))
})

Deno.test('menuParser: accepts renamed main-dish labels', () => {
	const menu = parseMenuHtml(
		card(
			'ALMOÇO',
			`<p><strong>Prato Proteico</strong></p><p>Ovos mexidos</p>`,
		),
	)

	strictEqual(menu.lunch?.mainDish, 'Ovos mexidos')
})

Deno.test('menuParser: preserves unknown sections instead of dropping them', () => {
	const menu = parseMenuHtml(
		card(
			'ALMOÇO',
			`<p><strong>Prato Principal</strong></p><p>Carne ensopada</p>
			<p><strong>Molhos</strong></p><p>Barbecue</p>`,
		),
	)

	strictEqual(menu.lunch?.mainDish, 'Carne ensopada')
	ok(menu.lunch?.rawBlock.includes('*Molhos:* Barbecue'))
})

Deno.test('menuParser: ignores meal names in navigation and uses the real card', () => {
	const menu = parseMenuHtml(
		`<nav><a href="#">Almoço</a><a href="#">Jantar</a></nav>` +
			card(
				'ALMOÇO',
				`<p><strong>Prato Principal</strong></p><p>Frango acebolado</p>`,
			),
	)

	strictEqual(menu.lunch?.mainDish, 'Frango acebolado')
})

Deno.test('menuParser: parses the RSS feed fallback', () => {
	const menu = parseMenuRss(`<?xml version="1.0"?><rss><channel>
		<item>
			<title>ALMOÇO 12/11/26</title>
			<description><![CDATA[Prato Principal
Frango acebolado
Opção
Ovos mexidos
*O cardápio poderá sofrer alterações sem comunicação prévia]]></description>
		</item>
		<item>
			<title>JANTAR 12/11/26</title>
			<description><![CDATA[Prato Principal
Lombo suíno
*O cardápio poderá sofrer alterações sem comunicação prévia]]></description>
		</item>
	</channel></rss>`)

	strictEqual(menu.hasMenu, true)
	strictEqual(menu.lunch?.mainDish, 'Frango acebolado')
	strictEqual(menu.lunch?.optionDish, 'Ovos mexidos')
	strictEqual(menu.dinner?.mainDish, 'Lombo suíno')
})

Deno.test('menuParser: still parses breakfast fields', () => {
	const menu = parseMenuHtml(
		card(
			'CAFÉ DA MANHÃ',
			`<p><strong>Desjejum</strong></p><p>Pão de milho</p>
			<p><strong>Leite</strong></p><p>integral puro</p>
			<p><strong>Fruta</strong></p><p>Banana</p>
			<p><strong>Suco</strong></p><p>Maracujá</p>`,
		),
	)

	strictEqual(menu.breakfast?.bread, 'de milho')
	strictEqual(menu.breakfast?.milk, 'integral puro')
	strictEqual(menu.breakfast?.fruit, 'Banana')
	strictEqual(menu.breakfast?.juice, 'Maracujá')
	ok(menu.breakfast?.items.includes('Leite integral puro'))
})
