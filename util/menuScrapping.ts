import { allowedTags } from '../plugin/groupAnnouncer.ts'
import { delay, randomDelay } from './functions.ts'
import { sendMsg } from './messages.ts'
import cron from 'node-cron'

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
// temporary solution to fix the CA Cert problem

// schedule msg sending to 6 AM UTC-3
export function scheduleURMenuMsg() {
	cron.schedule('0 6 * * 1-5', sendURMenu, {
		timezone: process.env.TZ,
	})
}

// send the Menu Msg to all groups saveds by the "#all" tag + some others
async function sendURMenu() {
	const menu = await scrapURMenu()
	if (!menu) return

	const groups = allowedTags['#todos'].concat('5527997014112-1491836324@g.us')
	for (const g of groups) {
		await sendMsg.bind(g)(menu)
		await randomDelay()
	}
}

// regex to parse HTML data
const regexFood =
	/(CAFÉ DA MANHÃ|ALMOÇO|JANTAR)[\s\S]*?<div class="field-content">([\s\S]*?)<\/div>/gi
const regexTags = /<[^>]*>?/gm
// scrap university's restaurant menu
export default async function scrapURMenu() {
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
		print('MENUSCRAP', 'Error fetching menu', 'red', e)
		await delay(60_000)
		await randomDelay()
		return await scrapURMenu()
	}
}

const numPadding = (n: number) => (n < 10 ? '0' + n : n.toString()) // 4 => 04
function getDate() {
	const date = new Date()
	const day = numPadding(date.getDate())
	const month = numPadding(date.getMonth() + 1)
	const year = date.getFullYear()

	return { day, month, year }
}

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
