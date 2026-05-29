import { delay, randomDelay } from '../util/functions.ts'
import { readFile, writeFile } from 'node:fs/promises'
import { sendMsg } from '../util/msgAbstractions.ts'
import { allowedTags } from './groupAnnouncer.ts'
import cache from './cache.ts'
import cron from 'node-cron'

let day = '',
	month = '',
	year = ''
const numPadding = (n: number) => (n < 10 ? '0' + n : n.toString()) // 4 => 04
updateDate()
// schedule msg sending to 6 AM UTC-3
export function scheduleURMenuMsg() {
	cron.schedule('0 6 * * 1-5', () => sendURMenu(), {
		// cron time explanation
		// 0 = minute
		// 6 = hour
		// * = any day of the month
		// * = any month
		// 1-5 = mon-fri
		timezone: process.env.TZ,
		// timezone like: America/Sao_Paulo
	})

	// schedule checking for updates
	cron.schedule('*/15 7-19 * * 1-5', checkForUpdates, {
		timezone: process.env.TZ,
	})
}

let oldMenu = ''
async function checkForUpdates() {
	await randomDelay()
	const menu = await scrapURMenu()
	if (!menu) return

	oldMenu =
		oldMenu ||
		(await readFile('conf/gen/cache/menu.txt', { encoding: 'utf-8' }).catch(() => ''))

	if (oldMenu === menu) return
	print('MENUSCRAP', 'Menu updated', 'blue')
	sendURMenu(menu, 1)
	await cache.save()
}

// send the Menu Msg to all groups saveds by the "#all" tag + some others
export async function sendURMenu(menuStr = '', updated = 0) {
	await randomDelay()
	const menu = menuStr || (await scrapURMenu())
	if (!menu) return

	let msg = `RU - ${day}/${month}*\n${menu}`
	if (updated) msg = `*ATUALIZAÇÃO ${msg}`
	else msg = `*Planejamento ${msg}`

	const groups = process.env.DEV
		? [process.env.GROUPS0!]
		: allowedTags['#todos'].concat('5527997014112-1491836324@g.us')

	for (const g of groups) {
		const msgCtx = await sendMsg.bind(g)(msg)
		await randomDelay()
		await sendMsg.bind(g)({ pin: msgCtx.msg.key, time: 86_400, type: 1 })
		await randomDelay()
	}
	await writeFile('conf/gen/cache/menu.txt', menu)
	oldMenu = menu
}

// regex to parse HTML data
const regexFood =
	/(CAFÉ DA MANHÃ|ALMOÇO|JANTAR)[\s\S]*?<div class="field-content">([\s\S]*?)<\/div>/gi
const regexTags = /<[^>]*>?/gm
// scrap university's restaurant menu
export default async function scrapURMenu() {
	updateDate()
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

		return msg.trim()
	} catch (e: any) {
		print('MENUSCRAP', 'Error scraping menu', e?.stack, 'red')
		await delay(60_000)
		await randomDelay()
		return await scrapURMenu()
	}
}

function updateDate() {
	const date = new Date()
	day = numPadding(date.getDate())
	month = numPadding(date.getMonth() + 1)
	year = date.getFullYear().toString()
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
const Hours = {
	'CAFÉ DA MANHÃ': '7h-8h',
	ALMOÇO: '11h-13h30',
	JANTAR: '17h-19h',
}
function parseMenuData(match: str[]) {
	const meal = match[1] as keyof typeof Hours

	return (
		`\n> *${meal.toPascalCase()} ${Hours[meal]}*\n` +
		match[2]
			.replace(regexTags, '\n')
			.split('\n')
			.map(item => item.trim())
			.filter(item => item.length > 2 && !item.includes('*O cardápio poderá sofrer'))
			.map(v => (titles.includes(v) ? `*${v}:* ` : v + '\n'))
			.join('')
	)
}
