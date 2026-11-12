// Menu scraping - RU menu scrape plus daily bulletin
// Schedules menu sends, update checks and calendar cron
// Builds summary with weather and calendar events
import { analyzeCalendarEvents, type ClassifiedCalendar } from '@util/calendarAnalytics.ts'
import { type ParsedMenuResult, parseMenuHtml, parseMenuRss } from '@util/menuParser.ts'
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
		: getAllowedTagsList().concat('5527997014112-1491836324@g.us', '120363431477311658@g.us')

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

const MENU_URL = 'https://restaurante.saomateus.ufes.br/cardapio'

async function fetchMenuSource(url: string): Promise<string> {
	// Timeout so a hung RU site never wedges the bulletin; retries handle transient drops.
	const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
	if (!res.ok) throw new Error(`status=${res.status} url=${url}`)
	return await res.text()
}

function menuScore(menu: ParsedMenuResult | null): number {
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

// scrap university's restaurant menu
// HTML and RSS are independent sources: if the page markup changes, the feed
// usually still has the same menu, and the most complete parse wins.
export default async function scrapURMenu(
	retries = 0,
): Promise<ParsedMenuResult | null> {
	updateDate()
	const url = `${MENU_URL}/${year}-${month}-${day}`

	const [htmlResult, rssResult] = await Promise.allSettled([
		fetchMenuSource(url).then(parseMenuHtml),
		fetchMenuSource(`${MENU_URL}/rss/${year}-${month}-${day}`).then(parseMenuRss),
	])

	const htmlMenu = htmlResult.status === 'fulfilled' ? htmlResult.value : null
	const rssMenu = rssResult.status === 'fulfilled' ? rssResult.value : null
	const best = menuScore(rssMenu) > menuScore(htmlMenu) ? rssMenu : htmlMenu

	if (best?.hasMenu) {
		if (best === rssMenu) print('MENUSCRAP', 'Using RSS menu fallback', 'yellow')
		return best
	}

	// Only complain when neither source produced a menu, so a flaky secondary
	// feed does not spam the logs while the primary page still works.
	if (htmlResult.status === 'rejected') {
		print('MENUSCRAP', 'HTML menu fetch failed', htmlResult.reason, 'red')
	}
	if (rssResult.status === 'rejected') {
		print('MENUSCRAP', 'RSS menu fetch failed', rssResult.reason, 'red')
	}

	// Both sources answered and neither has a menu: RU has nothing published.
	// Do not hammer the site with retries on a closed day.
	const bothFetched = htmlResult.status === 'fulfilled' &&
		rssResult.status === 'fulfilled'
	if (bothFetched) return null

	if (retries >= 5) {
		print('MENUSCRAP', 'Max retries reached, giving up', 'red')
		return null
	}
	await delay(30_000)
	await randomDelay()
	return await scrapURMenu(retries + 1)
}

function updateDate() {
	const date = new Date()
	day = global.menuDay || numPadding(date.getDate())
	month = numPadding(date.getMonth() + 1)
	year = date.getFullYear().toString()
}
