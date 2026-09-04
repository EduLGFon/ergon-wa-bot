import { analyzeCalendarEvents, type ClassifiedCalendar } from '@util/calendarAnalytics.ts'
import { type ParsedMenuResult, parseMenuHtml } from '@util/menuParser.ts'
import { updateCalendarCache } from '@plugin/calendarParser.ts'
import { getAllowedTagsList } from '@plugin/groupAnnouncer.ts'
import { generateDailySummary } from '@util/dailySummary.ts'
import { delay, randomDelay } from '@util/functions.ts'
import { fetchWeatherForecast } from '@util/weather.ts'
import { sendMsg } from '@util/msgAbstractions.ts'
import cache from '@plugin/cache.ts'

let day = '',
	month = '',
	year = ''
const numPadding = (n: number) => (n < 10 ? '0' + n : n.toString()) // 4 => 04
updateDate()

export function scheduleURMenuMsg() {
	// Deno.cron runs in UTC, so we translate UTC-3 (America/Sao_Paulo) to UTC
	// 6 AM UTC-3 = 9 AM UTC
	Deno.cron('Send UR Menu', '0 9 * * *', () => sendURMenu())

	// schedule checking for updates (7 AM - 7 PM UTC-3 = 10 AM - 10 PM UTC)
	Deno.cron('Check for Menu Updates', '*/15 10-22 * * 1-5', checkForUpdates)

	// schedule calendar update every Sunday at 3 AM UTC-3 (6 AM UTC)
	Deno.cron('Update Calendar Cache', '0 6 * * 7', async () => {
		try {
			await updateCalendarCache()
			print('MENUSCRAP', 'Calendar cache updated', 'green')
		} catch (e) {
			print('MENUSCRAP', 'Failed to update calendar cache', e, 'red')
		}
	})

	// run once on startup
	updateCalendarCache().catch(() => null)
}

let oldMenuText = ''
async function checkForUpdates() {
	await randomDelay()
	const menu = await scrapURMenu()
	if (!menu || !menu.hasMenu) return

	oldMenuText = oldMenuText ||
		(await Deno.readTextFile('conf/gen/cache/menu.txt').catch(() => ''))

	if (oldMenuText === menu.rawFullText) return
	print('MENUSCRAP', 'Menu updated', 'blue')
	sendURMenu(menu, 1)
	await cache.save()
}

// send the Menu Msg to all groups saved by the "#all" tag + some others
export async function sendURMenu(
	menuData: ParsedMenuResult | null = null,
	updated = 0,
) {
	await randomDelay()
	updateDate()
	const date = new Date()

	// 1. Fetch menu if not provided
	const menu = menuData || (await scrapURMenu())

	// 2. Fetch weather forecast in parallel
	const weather = await fetchWeatherForecast()

	// 3. Process calendar events
	let classifiedCalendar: ClassifiedCalendar | null = null
	try {
		const calendarPath = `conf/gen/cache/calendar_${year}.json`
		let rawCalendar = await Deno.readTextFile(calendarPath).catch(() => null)
		if (!rawCalendar) {
			print('MENUSCRAP', 'Calendar cache missing. Fetching now...', 'yellow')
			await updateCalendarCache().catch((e) =>
				print('MENUSCRAP', 'Error initializing calendar cache', e, 'red')
			)
			rawCalendar = await Deno.readTextFile(calendarPath).catch(() => null)
		}

		if (rawCalendar) {
			const events: Record<string, any[]> = JSON.parse(rawCalendar)
			classifiedCalendar = analyzeCalendarEvents(events, date)
		}
	} catch (e: any) {
		print('MENUSCRAP', 'Error reading calendar cache', e.stack || e, 'red')
	}

	const hasMenu = Boolean(menu && menu.hasMenu)
	const hasCalendar = Boolean(classifiedCalendar && classifiedCalendar.hasEvents)

	if (!hasMenu && !hasCalendar) {
		print('MENUSCRAP', 'No menu and no calendar events to send.', 'yellow')
		return
	}

	// 4. Generate AI summary with deterministic fallback
	const dateStr = `${day}/${month}`

	const summary = await generateDailySummary({
		dateStr,
		weather,
		menu,
		calendar: classifiedCalendar,
	})

	// 5. Construct full message
	let msg = ''
	if (updated) {
		msg = `🔄 *ATUALIZAÇÃO DO CARDÁPIO* - *${dateStr}*\n\n`
	}

	msg += summary.trim()

	const groups = Deno.env.get('DEV')
		? [Deno.env.get('GROUPS0')!]
		: getAllowedTagsList().concat('5527997014112-1491836324@g.us')

	for (const g of groups) {
		if (!g) continue
		const msgCtx = await sendMsg.bind(g)(msg)
		await randomDelay()
		await sendMsg.bind(g)({ pin: msgCtx.msg.key, time: 86_400, type: 1 })
		await randomDelay()
	}

	if (menu?.rawFullText) {
		await Deno.writeTextFile('conf/gen/cache/menu.txt', menu.rawFullText)
		oldMenuText = menu.rawFullText
	}
}

// scrap university's restaurant menu
export default async function scrapURMenu(
	retries = 0,
): Promise<ParsedMenuResult | null> {
	updateDate()
	try {
		// Timeout so a hung RU site never wedges the bulletin; retries handle transient drops.
		const res = await fetch(
			`https://restaurante.saomateus.ufes.br/cardapio/${year}-${month}-${day}`,
			{ signal: AbortSignal.timeout(10_000) },
		)
		if (!res.ok) return null
		const txt = await res.text()
		return parseMenuHtml(txt)
	} catch (e: any) {
		print('MENUSCRAP', 'Error scraping menu', e?.stack || e, 'red')
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
