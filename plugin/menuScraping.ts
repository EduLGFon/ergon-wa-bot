import { delay, randomDelay } from '../util/functions.ts'
import { updateCalendarCache } from './calendarParser.ts'
import { getAllowedTagsList } from './groupAnnouncer.ts'
import { readFile, writeFile } from 'node:fs/promises'
import { sendMsg } from '../util/msgAbstractions.ts'
import { existsSync } from 'node:fs'
import cache from './cache.ts'
import cron from 'node-cron'

let day = '',
	month = '',
	year = ''
const numPadding = (n: number) => (n < 10 ? '0' + n : n.toString()) // 4 => 04
updateDate()
// schedule msg sending to 6 AM UTC-3
export function scheduleURMenuMsg() {
	cron.schedule('0 6 * * *', () => sendURMenu(), {
		// cron time explanation
		// 0 = minute
		// 6 = hour
		// * = any day of the month
		// * = any month
		// * = any day of the week
		timezone: process.env.TZ,
		// timezone like: America/Sao_Paulo
	})

	// schedule checking for updates
	cron.schedule('*/15 7-19 * * 1-5', checkForUpdates, {
		timezone: process.env.TZ,
	})

	// schedule calendar update every Sunday at 3 AM
	cron.schedule('0 3 * * 0', async () => {
		try {
			await updateCalendarCache()
			print('MENUSCRAP', 'Calendar cache updated', 'green')
		} catch (e) {
			print('MENUSCRAP', 'Failed to update calendar cache', e, 'red')
		}
	}, { timezone: process.env.TZ })

	// run once on startup
	updateCalendarCache().catch(() => null)
}

let oldMenu = ''
async function checkForUpdates() {
	await randomDelay()
	const menu = await scrapURMenu()
	if (!menu) return

	oldMenu = oldMenu ||
		(await readFile('conf/gen/cache/menu.txt', { encoding: 'utf-8' }).catch(
			() => '',
		))

	if (oldMenu === menu) return
	print('MENUSCRAP', 'Menu updated', 'blue')
	sendURMenu(menu, 1)
	await cache.save()
}

// send the Menu Msg to all groups saveds by the "#all" tag + some others
export async function sendURMenu(menuStr = '', updated = 0) {
	await randomDelay()
	const menu = menuStr || (await scrapURMenu())

	let calendarEventsStr = ''
	let hasCalendarEvents = false
	try {
		const calendarPath = `conf/gen/cache/calendar_${year}.json`
		if (!existsSync(calendarPath)) {
			print('MENUSCRAP', 'Calendar cache missing. Fetching now...', 'yellow')
			await updateCalendarCache().catch((e) =>
				print('MENUSCRAP', 'Error initializing calendar cache', e, 'red')
			)
		}

		if (existsSync(calendarPath)) {
			const events: Record<string, any[]> = JSON.parse(
				await readFile(calendarPath, 'utf-8'),
			)
			const todayEvents = events[`${day}/${month}/${year}`]
			if (todayEvents && todayEvents.length > 0) {
				hasCalendarEvents = true
				let outStr = `🎓 *Calendário Acadêmico:*\n`

				const eventsByPeriod: Record<string, any[]> = {}
				for (const e of todayEvents) {
					const p = e.periodo || 'GERAL'
					if (!eventsByPeriod[p]) eventsByPeriod[p] = []
					eventsByPeriod[p].push(e)
				}

				for (const p in eventsByPeriod) {
					outStr += `\n*[${p}]*\n`
					
					eventsByPeriod[p].sort((a, b) => {
						const rA = (a.responsavel || '').trim().toLowerCase()
						const rB = (b.responsavel || '').trim().toLowerCase()
						
						const getScore = (r: string) => {
							if (r === 'estudante' || r === 'estudantes') return 1
							if (r.includes('estudante') && r.includes('professor')) return 2
							return 3
						}
						return getScore(rA) - getScore(rB)
					})

					for (const e of eventsByPeriod[p]) {
						let prefix = ''
						if (e.grupo || e.responsavel) {
							const g = e.grupo ? e.grupo : ''
							const r = e.responsavel ? ` (${e.responsavel})` : ''
							prefix = `${g}${r}: `
						}
						let range = ''
						if (e.dateRange) {
							range = ` (${e.dateRange})`
						}
						
						let eventLine = `${prefix}${e.atividade}${range}`
						const isEstudante = (e.responsavel || '').trim().toLowerCase() === 'estudante'
						
						if (isEstudante) {
							outStr += ` 🔸 *${eventLine}*\n`
						} else {
							outStr += ` 🔸 ${eventLine}\n`
						}
					}
				}

				calendarEventsStr = outStr + `\n`
			}
		}
	} catch (e: any) {
		print('MENUSCRAP', 'Error reading calendar cache', e.stack, 'red')
	}

	if (!menu && !hasCalendarEvents) return

	let msg = ''
	if (menu) {
		msg = updated ? `🔄 *ATUALIZAÇÃO DO CARDÁPIO*` : `🍽️ *CARDÁPIO DO RU*`
		msg += ` - *${day}/${month}*\n`
		msg += menu.trimEnd() + (calendarEventsStr ? '\n\n' + calendarEventsStr : '')
	} else {
		msg = `📅 *HOJE NA UFES* - *${day}/${month}*\n\n`
		msg += calendarEventsStr.trim()
	}

	const groups = process.env.DEV
		? [process.env.GROUPS0!]
		: getAllowedTagsList().concat('5527997014112-1491836324@g.us')

	for (const g of groups) {
		const msgCtx = await sendMsg.bind(g)(msg)
		await randomDelay()
		await sendMsg.bind(g)({ pin: msgCtx.msg.key, time: 86_400, type: 1 })
		await randomDelay()
	}
	if (menu) {
		await writeFile('conf/gen/cache/menu.txt', menu)
		oldMenu = menu
	}
}

// regex to parse HTML data
const regexFood =
	/(CAFÉ DA MANHÃ|ALMOÇO|JANTAR)[\s\S]*?<div class="field-content">([\s\S]*?)<\/div>/gi
const regexTags = /<[^>]*>?/gm
// scrap university's restaurant menu
export default async function scrapURMenu(retries = 0): Promise<string | null> {
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
		if (retries >= 3) {
			print('MENUSCRAP', 'Max retries reached, giving up', 'red')
			return null
		}
		await delay(60_000)
		await randomDelay()
		return await scrapURMenu(retries + 1)
	}
}

function updateDate() {
	const date = new Date()
	day = global.menuDay || numPadding(date.getDate())
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
const MealEmojis = {
	'CAFÉ DA MANHÃ': '☕',
	ALMOÇO: '🍛',
	JANTAR: '🍲',
}
function parseMenuData(match: str[]) {
	const meal = match[1] as keyof typeof Hours

	let lines = match[2]
		.replace(regexTags, '\n')
		.split('\n')
		.map((item) => item.trim())
		.filter((item) => item.length > 2 && !item.includes('*O cardápio poderá sofrer'))

	if (meal === 'CAFÉ DA MANHÃ') {
		const items: string[] = []
		let currentTitle = ''
		for (const line of lines) {
			if (titles.includes(line)) {
				currentTitle = line
			} else {
				if (currentTitle === 'Fruta' || currentTitle === 'Suco') {
					items.push(`*${currentTitle}:* ${line}`)
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
		return `\n> ${MealEmojis[meal] || '🍽️'} *${meal.toPascalCase()} ${Hours[meal]}*\n- ${items.join(', ')}\n`
	}

	return (
		`\n> ${MealEmojis[meal] || '🍽️'} *${meal.toPascalCase()} ${Hours[meal]}*\n` +
		lines.map((v) => (titles.includes(v) ? `*${v}:* ` : v + '\n')).join('')
	)
}
