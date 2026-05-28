import { delay, randomDelay } from '../util/functions.ts'
import { readFile, writeFile } from 'node:fs/promises'
import { allowedTags } from './groupAnnouncer.ts'
import { sendMsg } from '../util/messages.ts'
import cron from 'node-cron'
import bot from '../wa.ts'

// schedule msg sending to 6 AM UTC-3
export function scheduleURMenuMsg() {
	cron.schedule('0 6 * * 1-5', sendURMenu, {
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
		timezone: process.env.TZ
	})
}

let oldMenu = ''
async function checkForUpdates() {
	await randomDelay()
	const menu = await scrapURMenu()
	if (!menu) return

	oldMenu = await readFile('conf/gen/temp/menu.txt', { encoding: 'utf-8' })
		.catch(() => '')

	if (oldMenu === menu) return
	print('MENUSCRAPING', 'Menu updated', 'blue')
	sendURMenu()
	await writeFile('conf/gen/temp/menu.txt', menu)
}

// send the Menu Msg to all groups saveds by the "#all" tag + some others
export async function sendURMenu() {
	await randomDelay()
	const menu = await scrapURMenu()
	if (!menu) return
	await writeFile('conf/gen/temp/menu.txt', menu)

	const groups = process.env.DEV ? [process.env.GROUPS0!] : allowedTags['#todos'].concat('5527997014112-1491836324@g.us')

	for (const g of groups) {
		const msgCtx = await sendMsg.bind(g)(menu)
		await randomDelay()
		await bot.sock.sendMessage(g, { pin: msgCtx.msg.key, time: 86_400, type: 1 })
		await randomDelay()
	}
}

// regex to parse HTML data
const regexFood =
	/(CAFÉ DA MANHÃ|ALMOÇO|JANTAR)[\s\S]*?<div class="field-content">([\s\S]*?)<\/div>/gi
const regexTags = /<[^>]*>?/gm
// scrap university's restaurant menu
export default async function scrapURMenu(updated = 0) {
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

		if (msg) {			
			return `*Planejamento RU - ${day}/${month}*\n` +
				msg + '\n*Atualizações neste planejamento serão avisadas, mas o RU pode trocar as opções de última hora'
		}
		return null
	} catch (e: any) {
		print('MENUSCRAP', 'Error scraping menu', e?.stack, 'red')
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
const Hours = {
	'CAFÉ DA MANHÃ': '7h-8h',
	'ALMOÇO': '11h-13h30',
	'JANTAR': '17h-19h',
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