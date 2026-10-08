// types - shared calendar types
export interface CalendarEvent {
	periodo: string
	grupo: string
	responsavel: string
	atividade: string
	dateRange?: string
}

export interface TextBlock {
	startIdx: number
	endIdx: number
	lines: string[]
	centerIdx: number
}

export interface TableLine {
	gPart: string
	rPart: string
	dPart: string
	aPart: string
	periodo: string
	year: number
	afterBreak: boolean
}

export interface DayMonth {
	day: number
	month: number
}
