// cache - calendar cache update
import { downloadAndConvertPdf, fetchCalendarLinks } from './fetch.ts'
import { parseResolutionText } from './parseResolution.ts'
import { parseBaseCalendarText } from './parseBase.ts'
import type { CalendarEvent } from './types.ts'

export async function updateCalendarCache(): Promise<Record<string, CalendarEvent[]>> {
	const year = new Date().getFullYear()
	const { base, resolutions } = await fetchCalendarLinks(year)
	await Deno.mkdir('conf/gen/cache', { recursive: true })
	await Deno.mkdir('conf/gen/temp', { recursive: true })
	const baseTxtPath = `conf/gen/temp/cal_${year}.txt`
	const baseText = await downloadAndConvertPdf(base, baseTxtPath)
	const events = parseBaseCalendarText(baseText, year)
	for (let i = 0; i < resolutions.length; i++) {
		const resTxtPath = `conf/gen/temp/cal_${year}_res_${i}.txt`
		const resText = await downloadAndConvertPdf(resolutions[i], resTxtPath)
		parseResolutionText(resText, events, year)
	}
	await Deno.writeTextFile(
		`conf/gen/cache/calendar_${year}.json`,
		JSON.stringify(events, null, 2),
	)
	return events
}
