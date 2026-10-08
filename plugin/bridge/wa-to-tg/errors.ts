// Relay error helpers - log routing and failure classification in one place.
//
// Edits, deletes and reactions fail for environmental reasons (expired
// windows, missing rights) far more often than bugs - these helpers keep that
// triage consistent so callers log at the right level instead of erroring.
export function describeErr(err: unknown): string {
	if (typeof err === 'string') return err
	const anyErr = err as { description?: unknown; message?: unknown }
	if (typeof anyErr?.description === 'string') return anyErr.description
	if (typeof anyErr?.message === 'string') return anyErr.message
	try {
		return JSON.stringify(err)
	} catch {
		return String(err)
	}
}

export function reactionErrorDescription(err: unknown): string {
	if (typeof err === 'string') return err
	const anyErr = err as { description?: unknown; message?: unknown }
	if (typeof anyErr?.description === 'string') return anyErr.description
	if (typeof anyErr?.message === 'string') return anyErr.message
	return ''
}

// True when Telegram rejected the call because the target message is gone
// (revoked on WA, pruned by Telegram, topic closed/deleted) rather than
// because of a bug - the mirror row outlives a deleted/expired message, so
// reactions, edits and notices racing that disappear are expected, not
// faults. Callers log these quietly (or not at all) instead of at error.
export function isTargetGone(err: unknown): boolean {
	const desc = reactionErrorDescription(err).toLowerCase()
	return (
		desc.includes('message to react not found') ||
		desc.includes('message thread not found') ||
		desc.includes('message is not modified') ||
		desc.includes('topic_id_invalid') ||
		desc.includes('not found')
	)
}

// Which Telegram edit endpoint a mirror kind needs. Stickers, polls,
// venues, contacts and locations have no bot-editable representation -
// attempting them only produces 400s, so they are skipped up front.
export function routeEdit(tgKind: string | undefined): 'text' | 'caption' | 'both' | 'skip' {
	switch (tgKind) {
		case 'text':
			return 'text'
		case 'media':
			return 'caption'
		case 'sticker':
		case 'special':
			return 'skip'
		default:
			return 'both'
	}
}

// Log an edit failure at the right level instead of always erroring:
// 'not modified' is a harmless duplicate, "can't be edited"/"not found" is
// an expired window, deleted message or wrong type - only the rest is a bug.
export function classifyEditError(err: unknown): 'debug' | 'warn' | 'error' {
	const desc = describeErr(err).toLowerCase()
	if (desc.includes('not modified')) return 'debug'
	if (desc.includes("can't be edited") || desc.includes('not found')) return 'warn'
	return 'error'
}

export function logEditFailure(tgMsgId: number, err: unknown, firstErr?: string): void {
	const level = classifyEditError(err)
	// 'not modified' duplicates are harmless - stay silent.
	if (level === 'debug') return
	const detail = `${describeErr(err)}${firstErr ? ` (first attempt: ${firstErr})` : ''}`
	const line = `[BRIDGE] edit of TG message ${tgMsgId} failed (${level}): ${detail}`
	if (level === 'warn') console.warn(line)
	else console.error(line)
}

export function logDeleteFailure(tgMsgId: number, err: unknown): void {
	const desc = reactionErrorDescription(err).toLowerCase()
	const line = `[BRIDGE] delete of TG message ${tgMsgId} failed: ${reactionErrorDescription(err)}`
	// Gone/expired mirrors are environmental, not bugs - stay silent.
	if (
		desc.includes('not found') || desc.includes("can't be deleted") || desc.includes('too old')
	) {
		return
	} else if (desc.includes('right') || desc.includes('admin') || desc.includes('forbidden')) {
		console.warn(`${line} (bot needs delete rights in the supergroup)`)
	} else {
		console.error(line)
	}
}
