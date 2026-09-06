// Disk-backed store for deleted ("revoked") messages.
// Captures text + media buffers to conf/gen/deleted so the dev-only
// gotcha command can reveal them later. Nothing is stored in the DB.
//
// Never-drop rule: every non-bot delete is archived, even when the media
// buffer is missing (evicted, never downloaded, expired view-once). In that
// case the media keys are persisted so gotcha can retry the download later.
import { downloadContentFromMessage, type MediaType } from 'baileys'
import { type Msg } from '@conf/types/types.d.ts'
import cache from '@plugin/cache.ts'

export interface DeletedEntry {
	id: str
	chat: str
	author: num
	authorName: str
	type: str
	text: str
	mime: str
	ts: num
	mediaFile?: str
	mediaMime?: str
	// Media keys persisted so a missing buffer can be re-downloaded later.
	mediaUrl?: str
	directPath?: str
	mediaKey?: str
	// True when neither text nor media could be captured.
	unavailable?: bool
	// True when archived from a reply quoting a view-once (not from a revoke).
	viaQuote?: bool
	// True for speculative quote copies of an unseen original. Hidden from
	// gotcha until a revoke for the same id promotes them (the original was
	// never cached, so the quote may be the only surviving copy).
	pending?: bool
}

const BASE = 'conf/gen/deleted'
const KEEP_PER_CHAT = 100

// Make a chat JID safe for use as a directory name.
function chatSafe(chat: str): str {
	return chat.replace(/[^a-zA-Z0-9]/g, '_')
}

function chatDir(chat: str): str {
	return `${BASE}/${chatSafe(chat)}`
}

function indexPath(chat: str): str {
	return `${chatDir(chat)}/index.json`
}

// Load all stored deletes for a chat (oldest first).
async function loadIndex(chat: str): Promise<DeletedEntry[]> {
	const raw = await Deno.readTextFile(indexPath(chat)).catch(() => null)
	if (!raw) return []
	try {
		const parsed = JSON.parse(raw)
		return Array.isArray(parsed) ? parsed as DeletedEntry[] : []
	} catch {
		return []
	}
}

async function writeIndex(chat: str, entries: DeletedEntry[]): Promise<void> {
	await Deno.mkdir(chatDir(chat), { recursive: true })
	await Deno.writeTextFile(indexPath(chat), JSON.stringify(entries))
}

// Guess a file extension for a stored media buffer.
function extFor(mime: str, type: str): str {
	const m = (mime || '').toLowerCase()
	if (m.includes('jpeg') || m.includes('jpg')) return 'jpg'
	if (m.includes('png')) return 'png'
	if (m.includes('webp')) return 'webp'
	if (m.includes('gif')) return 'gif'
	if (m.includes('mp4')) return 'mp4'
	if (m.includes('ogg') || m.includes('opus')) return 'ogg'
	if (m.includes('mp3') || m.includes('mpeg')) return 'mp3'
	if (m.includes('pdf')) return 'pdf'
	if (type === 'video') return 'mp4'
	if (type === 'audio') return 'ogg'
	if (type === 'image') return 'jpg'
	if (type === 'sticker') return 'webp'
	if (type === 'document') return 'bin'
	return 'bin'
}

// Find the original cached message for a deleted id, if still in memory.
function findCachedOriginal(chat: str, deletedId: str): Msg | undefined {
	if (chat.includes('@g.us')) return cache.groups.get(chat)?.msgs.get(deletedId)

	const byLid = cache.users.find((u) => u.lid === chat)?.msgs.get(deletedId)
	if (byLid) return byLid
	const byPhone = cache.users.find((u) => u.phone === chat.parsePhone())?.msgs.get(deletedId)
	if (byPhone) return byPhone

	// Fallback: scan all chats (ids are unique per message, cheap enough on revoke).
	for (const g of cache.groups.values()) {
		const hit = g.msgs.get(deletedId)
		if (hit && hit.chat === chat) return hit
	}
	for (const u of cache.users.values()) {
		const hit = u.msgs.get(deletedId)
		if (hit && hit.chat === chat) return hit
	}
	return undefined
}

// Encode a proto mediaKey (Buffer/Uint8Array at runtime) as JSON-safe base64.
// Baileys accepts base64 strings back in getMediaKeys, so roundtrip is safe.
function keyToJson(key: any): str | undefined {
	if (!key) return undefined
	if (typeof key === 'string') return key
	try {
		return Buffer.from(key as Uint8Array).toString('base64')
	} catch {
		return undefined
	}
}

// writeBufferFile: persist a media buffer next to the chat index.
async function writeBufferFile(
	chat: str,
	id: str,
	buffer: Buf,
	mimeHint: str,
	type: str,
	viaQuote?: bool,
): Promise<{ file: str; mime: str }> {
	const ext = extFor(mimeHint, type)
	const prefix = viaQuote ? 'media_quote_' : 'media_'
	const file = `${prefix}${Date.now()}_${id.replace(/[^a-zA-Z0-9]/g, '')}.${ext}`
	await Deno.mkdir(`${chatDir(chat)}/media`, { recursive: true })
	await Deno.writeFile(`${chatDir(chat)}/media/${file}`, buffer)
	return { file, mime: mimeHint }
}

// persistEntry: dedupe/append/prune/write the index, storing a buffer file
// when given. Shared by the revoke path and the quote-rescue path.
// - new id -> archived (returned)
// - known id, speculative existing + real incoming -> promoted: revoke data
//   wins but any buffer the speculative copy secured is kept (returned)
// - otherwise -> pure dupe (null)
async function persistEntry(
	chat: str,
	entry: DeletedEntry,
	buffer?: Buf | null,
	mimeHint?: str,
): Promise<DeletedEntry | null> {
	const entries = await loadIndex(chat)
	const existing = entries.find((e) => e.id === entry.id)

	if (existing) {
		if (!existing.pending || entry.pending) return null
		let file = existing.mediaFile
		let mime = existing.mediaMime
		if (!file && buffer?.length) {
			;({ file, mime } = await writeBufferFile(
				chat,
				entry.id,
				buffer,
				mimeHint || entry.mime,
				entry.type,
				existing.viaQuote,
			))
		}
		const viaQuote = existing.viaQuote
		Object.assign(existing, entry, {
			mediaFile: file,
			mediaMime: mime,
			pending: false,
			viaQuote,
		})
		await writeIndex(chat, entries)
		print('GOTCHA', `rescued ${chat} ${entry.id} (${entry.type} via quote)`, 'green')
		return existing
	}

	if (buffer?.length) {
		const { file, mime } = await writeBufferFile(
			chat,
			entry.id,
			buffer,
			mimeHint || entry.mime,
			entry.type,
			entry.viaQuote,
		)
		entry.mediaFile = file
		entry.mediaMime = mime
		entry.unavailable = false
	}
	entries.push(entry)

	// Bound disk usage: drop oldest entries (and their media files).
	while (entries.length > KEEP_PER_CHAT) {
		const dropped = entries.shift()!
		if (dropped.mediaFile) {
			await Deno.remove(`${chatDir(chat)}/media/${dropped.mediaFile}`).catch(() => {})
		}
	}
	await writeIndex(chat, entries)
	return entry
}

// Save a copy of a message that was just deleted for everyone.
// Never drops: entries without text/media are kept as placeholders so the
// delete itself stays visible. Returns null only for dupes/bot messages.
async function saveDeleted(msg: Msg): Promise<DeletedEntry | null> {
	if (!msg || msg.isBot) return null

	const chat = msg.chat
	const authorUser = cache.users.find((u) => u.id === msg.author)
	const media = msg.media
	const entry: DeletedEntry = {
		id: msg.key.id!,
		chat,
		author: msg.author,
		authorName: authorUser?.name || authorUser?.phone || 'user',
		type: msg.type,
		text: msg.text || '',
		mime: msg.mime || '',
		ts: Date.now(),
		unavailable: !msg.text && !media?.url,
		mediaUrl: media?.url,
		directPath: media?.directPath,
		mediaKey: keyToJson(media?.mediaKey),
	}

	// Persist media buffer next to the index so gotcha can re-send it.
	const url = media?.url
	const cached = url ? cache.media.get(url) : undefined
	const saved = await persistEntry(chat, entry, cached?.buffer, cached?.mime || msg.mime)
	if (!saved) return null
	return saved
}

// Save a speculative copy of a quoted message whose original is not cached
// (stanzaId = original id). Hidden from gotcha (pending) until a revoke for
// the same id promotes it - the quote may be the only surviving copy when
// the original was never received (sent before bot start, cache eviction).
async function savePendingQuote(input: {
	chat: str
	id: str
	author: num
	authorName: str
	type: str
	text: str
	mime: str
	media?: MediaMsg
}): Promise<DeletedEntry | null> {
	if (!input.id || !input.chat) return null

	const entry: DeletedEntry = {
		id: input.id,
		chat: input.chat,
		author: input.author,
		authorName: input.authorName || 'user',
		type: input.type,
		text: input.text || '',
		mime: input.mime || '',
		ts: Date.now(),
		viaQuote: true,
		pending: true,
		unavailable: !input.text && !input.media?.url,
		mediaUrl: input.media?.url,
		directPath: input.media?.directPath,
		mediaKey: keyToJson(input.media?.mediaKey),
	}

	const cached = input.media?.url ? cache.media.get(input.media.url) : undefined
	const saved = await persistEntry(input.chat, entry, cached?.buffer, cached?.mime || input.mime)
	if (!saved) return null
	return saved
}

// Promote a speculative quote copy when its revoke arrives but the original
// was never cached. Returns the entry, or null when there is nothing stashed.
async function promotePendingDelete(chat: str, id: str): Promise<DeletedEntry | null> {
	const entries = await loadIndex(chat)
	const hit = entries.find((e) => e.id === id && e.pending)
	if (!hit) return null
	hit.pending = false
	await writeIndex(chat, entries)
	print('GOTCHA', `rescued ${chat} ${id} (${hit.type} via quote)`, 'green')
	return hit
}

// List recent deletes for a chat (oldest first, sliced to the last N).
// Speculative (pending) copies stay hidden until a revoke promotes them.
async function listDeleted(chat: str, limit: num): Promise<DeletedEntry[]> {
	const entries = (await loadIndex(chat)).filter((e) => !e.pending)
	if (limit <= 0) return entries
	return entries.slice(-limit)
}

// Read a stored media buffer for an entry, or null when missing.
async function readDeletedMedia(chat: str, entry: DeletedEntry): Promise<Buf | null> {
	if (!entry.mediaFile) return null
	const data = await Deno.readFile(`${chatDir(chat)}/media/${entry.mediaFile}`).catch(() => null)
	return data ? Buffer.from(data) : null
}

// Map a stored msg type to a Baileys download type.
function retryKind(type: str): MediaType | undefined {
	if (type === 'image' || type === 'video' || type === 'audio' || type === 'sticker') {
		return type as MediaType
	}
	if (type === 'document') return 'document' as MediaType
	return undefined
}

// Retry downloading a missing buffer from WhatsApp servers using the
// persisted media keys (covers receipt-time failures and cache evictions).
// On success the buffer is written to disk and the index updated.
async function fetchMissingMedia(entry: DeletedEntry): Promise<Buf | null> {
	if (entry.mediaFile || !entry.mediaKey || !entry.mediaUrl) return null
	const kind = retryKind(entry.type)
	if (!kind) return null

	try {
		const stream = await downloadContentFromMessage(
			{
				mediaKey: Buffer.from(entry.mediaKey, 'base64'),
				directPath: entry.directPath,
				url: entry.mediaUrl,
			},
			kind,
			{},
		)
		const chunks: Uint8Array[] = []
		for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) chunks.push(chunk)
		const buf = Buffer.concat(chunks)
		if (!buf.length) return null

		const ext = extFor(entry.mediaMime || '', entry.type)
		const file = `media_retry_${Date.now()}_${entry.id.replace(/[^a-zA-Z0-9]/g, '')}.${ext}`
		await Deno.mkdir(`${chatDir(entry.chat)}/media`, { recursive: true })
		await Deno.writeFile(`${chatDir(entry.chat)}/media/${file}`, buf)

		const entries = await loadIndex(entry.chat)
		const hit = entries.find((e) => e.id === entry.id)
		if (hit) {
			hit.mediaFile = file
			hit.unavailable = false
			await writeIndex(entry.chat, entries)
		}
		entry.mediaFile = file
		entry.unavailable = false
		print('GOTCHA', `re-downloaded ${entry.chat} ${entry.id}`, 'green')
		return buf
	} catch (e) {
		print('GOTCHA/fetch', (e as Error)?.message || e, 'red')
		return null
	}
}

export {
	fetchMissingMedia,
	findCachedOriginal,
	listDeleted,
	promotePendingDelete,
	readDeletedMedia,
	saveDeleted,
	savePendingQuote,
}
