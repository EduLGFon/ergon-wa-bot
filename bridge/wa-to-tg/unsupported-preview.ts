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
			case 'pollCreationMessageV3': {
				const q = truncateOneLine(node.name, 120)
				const opts = Array.isArray(node.options)
					? node.options
						.map((o: any) => String(o?.optionName ?? '').trim())
						.filter(Boolean)
					: []
				if (q && opts.length > 0) return `${q} (${opts.slice(0, 5).join(' / ')})`
				return q ?? (opts.length > 0 ? truncateOneLine(opts.slice(0, 5).join(' / ')) : null)
			}
			case 'pollResultSnapshotMessage':
				return truncateOneLine(node.name, 160)
			case 'albumMessage':
				return firstString(node, ['caption'])
			case 'contactsArrayMessage': {
				const list = Array.isArray(node.contacts) ? node.contacts : []
				const names = list
					.map((c: any) => String(c?.displayName ?? '').trim())
					.filter(Boolean)
					.slice(0, 3)
				return truncateOneLine(
					`${list.length} contact${list.length === 1 ? '' : 's'}${
						names.length > 0 ? `: ${names.join(', ')}` : ''
					}`,
				)
			}
			case 'groupInviteMessage':
				return firstString(node, ['groupName', 'caption']) ??
					truncateOneLine(
						[node.groupName, node.inviteCode ? `code ${node.inviteCode}` : null]
							.filter(Boolean)
							.join(' '),
					)
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
			case 'eventMessage':
				return firstString(node, ['name', 'description', 'location']) ??
					(typeof node.startTime === 'number' ? `starts ${node.startTime}` : null)
			case 'eventResponseMessage':
				return firstString(node, ['eventName']) ??
					(typeof node.response === 'string'
						? truncateOneLine(`response ${node.response}`)
						: null)
			case 'callLogMessage':
				return firstString(node, ['displayName']) ??
					(typeof node.duration === 'number'
						? truncateOneLine(`duration ${node.duration}s`)
						: null)
			case 'scheduledCallCreationMessage':
			case 'scheduledCallEditMessage':
				return firstString(node, ['scheduledCallName', 'title'])
			case 'productMessage':
			case 'orderMessage':
			case 'invoiceMessage':
				return firstString(node, ['title', 'description', 'currencyCode'])
			case 'stickerPackMessage':
				return firstString(node, ['name', 'stickerPackId'])
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
