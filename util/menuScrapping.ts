import { allowedTags } from '../plugin/groupAnnouncer.js'
import { delay, randomDelay } from './functions.js'
import { sendMsg } from './messages.js'

const titles = [
	// menu titles
	'Acompanhamentos',
	'Prato Principal',
	'Acompanhamento',
	'Guarnição',
	'Sobremesa',
	'Desjejum',
	'Saladas',
	'Leite',
	'Fruta',
	'Opção',
	'Suco',
	'Café',
]

const regexFood =
	/(CAFÉ DA MANHÃ|ALMOÇO|JANTAR)[\s\S]*?<div class="field-content">([\s\S]*?)<\/div>/gi
const regexTags = /<[^>]*>?/gm
const numPadding = (n: number) => (n < 10 ? '0' + n : n.toString()) // 4 => 04

export function scheduleURMenuMsg() {
	const now = new Date()
	const nextRun = new Date()
	nextRun.setHours(9, 30, 0, 0)

	console.log(now, nextRun)
	if (nextRun <= now) nextRun.setDate(nextRun.getDate() + 1)
	const delay = nextRun.getTime() - now.getTime()
	console.log(now, nextRun)
	console.log(delay)

	setTimeout(sendURMenu, delay)
}

async function sendURMenu() {
	const menu = await scrapURMenu()
	if (!menu) return scheduleURMenuMsg()

	for (const g of allowedTags['#todos']) {
		await sendMsg.bind(g)(menu)
		await randomDelay()
	}

	scheduleURMenuMsg()
}

export default scrapURMenu
// scrap university's restaurant menu
async function scrapURMenu() {
	const { day, month, year } = getDate()
	try {
		const res = await fetch(
			`https://restaurante.saomateus.ufes.br/cardapio/${year}-${month}-${day}`,
		)
		if (!res.ok) return null
		const txt = await res.text()
		let msg = ''

		for (const match of txt.matchAll(regexFood)) {
			msg += parseMenuData(match)
		}
		msg = msg.trim()

		if (msg)
			return (
				`*Cardápio RU - ${day}/${month}*\n` +
				msg +
				'\n*O cardápio poderá sofrer alterações sem comunicação prévia'
			)
		return null
	} catch (e) {
		console.log('MENUSCRAP', 'Error fetching menu', 'red')
		console.log(e)
		await delay(60_000)
		return await scrapURMenu()
	}
}

function getDate() {
	const date = new Date()
	const day = numPadding(date.getDate())
	const month = numPadding(date.getMonth() + 1)
	const year = date.getFullYear()

	return { day, month, year }
}

function parseMenuData(match: str[]) {
	return (
		`\n> *${match[1]}*\n` +
		match[2]
			.replace(regexTags, '\n')
			.split('\n')
			.map(item => item.trim())
			.filter(item => item.length > 2 && !item.includes('*O cardápio poderá sofrer'))
			.map(v => (titles.includes(v) ? `*${v}:* ` : v + '\n'))
			.join('')
	)
}
