// Unsupported content preview - human summaries for types with no mapping.
//
// Telegram has no equivalent for polls votes, invites, events and similar -
// this extracts a one-line content hint per type so the topic shows WHAT did
// not cross, never just that something did not.
export function truncateOneLine(v: unknown, max = 200): string | null {
	if (typeof v !== 'string') return null
	const oneLine = v.replace(/\s+/g, ' ').trim()
	if (!oneLine) return null
	return oneLine.length > max ? oneLine.slice(0, max) + '…' : oneLine
}

export function firstString(node: any, keys: string[], max = 200): string | null {
	if (!node || typeof node !== 'object') return null
	for (const k of keys) {
		const hit = truncateOneLine(node[k], max)
		if (hit) return hit
	}
	return null
}

// Render question + first options of a poll-shaped node.
function renderPoll(node: any): string | null {
	if (!node || typeof node !== 'object') return null
	const q = truncateOneLine(node.name, 120)
	const opts = Array.isArray(node.options)
		? node.options
			.map((o: any) => String(o?.optionName ?? '').trim())
			.filter(Boolean)
		: []
	if (q && opts.length > 0) return `${q} (${opts.slice(0, 5).join(' / ')})`
	return q ?? (opts.length > 0 ? truncateOneLine(opts.slice(0, 5).join(' / ')) : null)
}

// One-line preview of a poll-creation node. Direct versions are poll-shaped;
// V4 and the option-image variant wrap that payload in a FutureProofMessage
// envelope (`message` field), so probe the version keys first and recurse.
function pollPreview(node: any): string | null {
	if (!node || typeof node !== 'object') return null
	const direct = node.pollCreationMessage || node.pollCreationMessageV2 ||
		node.pollCreationMessageV3 || node.pollCreationMessageV5
	if (direct) return renderPoll(direct)
	const wrapped = node.pollCreationMessageV4 || node.pollCreationOptionImageMessage
	if (wrapped) return pollPreview(wrapped.message)
	return renderPoll(node)
}

// Best-effort human preview of an unsupported node's CONTENT (never the
// quoted subtree - that belongs to another message). Each branch only reads
// plain string/number fields, so exotic shapes safely fall through to the
// generic string scan at the end.
export function previewUnsupportedContent(primary: string, node: any): string | null {
	try {
		if (!node || typeof node !== 'object') return null
		switch (primary) {
			case 'pollUpdateMessage': {
				const votes = node.vote?.selectedOptions
				if (Array.isArray(votes)) {
					const names = votes
						.map((o: any) => String(o?.name ?? o?.optionName ?? '').trim())
						.filter(Boolean)
					if (names.length > 0) return truncateOneLine(`voted: ${names.join(', ')}`)
				}
				return firstString(node.vote ?? node, ['name', 'optionName'])
			}
			case 'pollCreationMessage':
			case 'pollCreationMessageV2':
			case 'pollCreationMessageV3':
			case 'pollCreationMessageV4':
			case 'pollCreationMessageV5':
			case 'pollCreationOptionImageMessage':
				return pollPreview(node)
			case 'pollResultSnapshotMessage':
				return truncateOneLine(node.name, 160)
			case 'albumMessage':
				return firstString(node, ['caption'])
			case 'buttonsMessage':
			case 'templateMessage':
			case 'interactiveMessage':
			case 'listMessage':
				return firstString(node, [
					'contentText',
					'title',
					'description',
					'text',
					'caption',
					'footerText',
				])
			case 'buttonsResponseMessage':
				return firstString(node, ['selectedDisplayText', 'selectedButtonId'])
			case 'templateButtonReplyMessage':
				return firstString(node, ['selectedDisplayText', 'selectedId', 'selectedIndex'])
			case 'listResponseMessage':
				return firstString(node, ['title', 'description']) ??
					firstString(node.singleSelectReply ?? {}, ['selectedRowId'])
			case 'interactiveResponseMessage':
			case 'nativeFlowResponseMessage':
				return firstString(node, ['body', 'title']) ??
					firstString(node.nativeFlowResponseMessage ?? {}, ['name', 'paramsJson'])
			case 'productMessage':
			case 'orderMessage':
			case 'invoiceMessage':
				return firstString(node, ['title', 'description', 'currencyCode'])
			case 'newsletterAdminInviteMessage':
				return firstString(node, ['newsletterName', 'caption'])
			case 'highlyStructuredMessage':
				return firstString(node, ['namespace', 'templateId']) ??
					firstString(node.params ?? {}, ['fallbackLg', 'fallbackLc'])
			default: {
				// Generic last resort: first short human-looking string field
				// on the node (skips ids/keys/hashes by length and shape).
				for (const [k, v] of Object.entries(node)) {
					if (k === 'contextInfo' || k === 'quotedMessage') continue
					if (
						typeof v === 'string' && v.trim().length >= 2 && v.length <= 300 &&
						!/^[A-Za-z0-9+/=]{32,}$/.test(v)
					) {
						const hit = truncateOneLine(v)
						if (hit) return hit
					}
				}
				return null
			}
		}
	} catch {
		return null
	}
}
