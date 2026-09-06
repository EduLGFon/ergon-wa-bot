// Shared text-format helpers for the bridge (pure functions, no side effects).
//
// Telegram and WhatsApp use incompatible rich-text models:
//   - Telegram: explicit `entities` with UTF-16 offsets (bold, italic, …).
//   - WhatsApp: inline markers (*bold*, _italic_, ~strike~, `code`, ```pre```).
// These converters translate between them tolerantly — anything unrecognized
// passes through as plain text rather than failing the relay.

export type TgEntityType = 'bold' | 'italic' | 'strikethrough' | 'code' | 'pre'

export interface TgEntity {
	type: TgEntityType
	offset: number
	length: number
}

// Telegram entities (UTF-16 offsets, as Bot API sends them) → WhatsApp-marker
// text. Unmapped types (underline, spoiler, quotes, …) pass through as plain
// text; text_link expands to `text (url)` since WA has no named links.
export function tgEntitiesToWa(text: string, entities?: any[] | null): string {
	if (!text || !entities?.length) return text || ''
	// Insertion map on the ORIGINAL string: sequential splicing would shift
	// the offsets of enclosing (nested) entities, so all markers are placed
	// simultaneously. At shared boundaries closes go before opens, and among
	// the same kind the outer (longer) marker goes first at starts / last at
	// ends — this keeps nesting (`*aaa _bbb_ c*`) intact.
	interface Ins {
		pos: number
		mark: string
		open: boolean
		len: number
	}
	const inss: Ins[] = []
	for (const e of entities) {
		if (typeof e?.offset !== 'number' || typeof e?.length !== 'number') continue
		if (e.offset < 0 || e.length <= 0 || e.offset + e.length > text.length) continue
		let open = '', close = ''
		switch (e.type) {
			case 'bold':
				open = close = '*'
				break
			case 'italic':
				open = close = '_'
				break
			case 'strikethrough':
				open = close = '~'
				break
			case 'code':
				open = close = '`'
				break
			case 'pre':
				open = close = '```'
				break
			case 'text_link':
				if (e.url) close = ` (${e.url})`
				break
			default:
				continue
		}
		if (open) inss.push({ pos: e.offset, mark: open, open: true, len: e.length })
		if (close) inss.push({ pos: e.offset + e.length, mark: close, open: false, len: e.length })
	}
	inss.sort((a, b) =>
		b.pos - a.pos ||
		(Number(a.open) - Number(b.open)) ||
		(a.open ? a.len - b.len : b.len - a.len) ||
		(a.open ? -1 : 1) * (a.mark < b.mark ? -1 : a.mark > b.mark ? 1 : 0)
	)
	let out = text
	for (const ins of inss) {
		out = out.slice(0, ins.pos) + ins.mark + out.slice(ins.pos)
	}
	return out
}

// WhatsApp-marker text → Telegram { text (markers stripped), entities }.
// Tolerant: unmatched or malformed markers stay literal. Only single-line
// spans are recognized, except ```pre``` which may span lines. `pre` is
// matched before `code` so triple backticks aren't eaten as empty code spans.
export function waMarkdownToTgEntities(raw: string): { text: string; entities: TgEntity[] } {
	if (!raw) return { text: '', entities: [] }
	interface Span {
		start: number
		end: number
		type: TgEntityType
	}
	// First pass: find spans in the ORIGINAL string (offsets refer to it).
	const spans: Span[] = []
	const taken: boolean[] = new Array(raw.length).fill(false)
	const claim = (s: number, e: number): boolean => {
		for (let i = s; i < e; i++) if (taken[i]) return false
		for (let i = s; i < e; i++) taken[i] = true
		return true
	}
	const matchSpans = (marker: string, type: TgEntityType, multiline: boolean): void => {
		let i = 0
		while (i < raw.length) {
			const open = raw.indexOf(marker, i)
			if (open < 0) break
			const innerStart = open + marker.length
			const close = raw.indexOf(marker, innerStart)
			if (close < 0) break
			const inner = raw.slice(innerStart, close)
			const okShape = inner.length > 0 && !/^\s/.test(inner) && !/\s$/.test(inner) &&
				(multiline || !inner.includes('\n'))
			if (okShape && claim(open, close + marker.length)) {
				spans.push({ start: open, end: close + marker.length, type })
				i = close + marker.length
			} else {
				i = open + 1
			}
		}
	}
	matchSpans('```', 'pre', true)
	matchSpans('*', 'bold', false)
	matchSpans('_', 'italic', false)
	matchSpans('~', 'strikethrough', false)
	matchSpans('`', 'code', false)

	if (!spans.length) return { text: raw, entities: [] }
	spans.sort((a, b) => a.start - b.start)

	// Second pass: strip markers, shifting entity offsets accordingly.
	let text = ''
	const entities: TgEntity[] = []
	let cursor = 0
	for (const s of spans) {
		text += raw.slice(cursor, s.start)
		const mlen = s.type === 'pre' ? 3 : 1
		const inner = raw.slice(s.start + mlen, s.end - mlen)
		entities.push({ type: s.type, offset: text.length, length: inner.length })
		text += inner
		cursor = s.end
	}
	text += raw.slice(cursor)
	return { text, entities }
}

// Minimal vCard parse (WhatsApp contactMessage.vcard) → { name, phone }.
// Handles `FN:` and `TEL…:number` lines; enough for sendContact + fallback.
export function parseVcard(vcard: string | null | undefined): { name: string; phone: string } {
	let name = ''
	let phone = ''
	if (vcard) {
		for (const line of vcard.split('\n')) {
			const upper = line.toUpperCase()
			if (!name && upper.startsWith('FN:')) name = line.slice(3).trim()
			else if (!phone && upper.startsWith('TEL')) {
				const idx = line.indexOf(':')
				if (idx >= 0) phone = line.slice(idx + 1).replace(/[^\d+]/g, '').trim()
			}
		}
	}
	return { name, phone }
}
