// calendarParser - facade re-exporting calendar modules
export { areDuplicateActivities, normalizeActivity } from './calendar/expand.ts'
export { downloadAndConvertPdf, fetchCalendarLinks } from './calendar/fetch.ts'
export type { CalendarEvent, TableLine, TextBlock } from './calendar/types.ts'
export { parseResolutionText } from './calendar/parseResolution.ts'
export { parseBaseCalendarText } from './calendar/parseBase.ts'
export { updateCalendarCache } from './calendar/cache.ts'

const isMain = import.meta.main
if (isMain) {
	const { updateCalendarCache } = await import('./calendar/cache.ts')
	updateCalendarCache().then((events) => {
		console.log('Cached successfully. Events:')
		console.log(events['15/07'])
	}).catch(console.error)
}
