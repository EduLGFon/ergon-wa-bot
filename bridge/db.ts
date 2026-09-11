// SQLite mapping store for the WA-Telegram bridge.
// Persists chat and reply mappings at conf/gen/bridge.db.
// Lets restarts resume relay without losing topic links.
// Uses node:sqlite (Deno built-in compat, no npm dep) plus Deno.mkdir/stat.
import { DatabaseSync } from 'node:sqlite'

export interface MappingRow {
	whatsapp_jid: string
	telegram_topic_id: number
	display_name: string
	chat_type: '1:1' | 'group'
	created_at: number
	last_active_at: number
	archived: boolean
	// Per-chat mute (/mute): relay skips the chat in both directions.
	muted: boolean
	// Which supergroup hosts this topic. '' on rows from single-group DBs
	// until backfillLegacyChat() stamps them at boot.
	telegram_chat_id: string
	// Personal/business routing. New chats start 'undecided' in the
	// default (personal) group until the owner picks via topic buttons.
	bucket: Bucket
	// Bot prompt message asking personal-or-business (button taps resolve
	// the chat through this ID - callback payloads are capped at 64 bytes).
	prompt_msg_id: number | null
}

// Personal/business bucket for dual-supergroup routing.
export type Bucket = 'personal' | 'business' | 'undecided'

export interface ReplyMapRow {
	tg_msg_id: number
	// Supergroup hosting the mirror message. Composite key with tg_msg_id -
	// message IDs collide across groups, so neither column is unique alone.
	tg_chat_id: string
	wa_jid: string
	wa_msg_id: string
	wa_key_json: string
	created_at: number
	// What KIND of Telegram message mirrors the WA one (text/media/sticker/
	// special). Tells the edit path which endpoint to use; 'unknown' for
	// rows written before this column existed (or TG-originated rows, whose
	// TG side is the original and never needs editing by the bot).
	tg_kind: string
	// Telegram reply target (message ID in the same group) this mirror was
	// sent as a reply to. Lets a topic move re-thread copied history.
	tg_reply_to: number | null
	// Last relayed mirror content (WA→TG rows only): plain body text plus
	// JSON-encoded entities. Lets a later revoke re-edit the mirror into a
	// spoiler tombstone instead of deleting it. Null for TG-originated rows
	// (the TG side is a user message the bot can't edit) and legacy rows.
	tg_text: string | null
	tg_entities: string | null
	// Poll metadata for vote relay (poll mirrors only, null otherwise):
	// the poll's messageSecret for vote encrypt/decrypt, the ordered option
	// names (TG answers carry indexes), the creator JID for the vote
	// signature, and the Telegram poll id linking poll_answer updates.
	wa_poll_secret: Uint8Array | null
	wa_poll_options: string | null
	wa_poll_creator: string | null
	tg_poll_id: string | null
	// Original messageSecret for encrypted-edit decryption. Newer WhatsApp
	// clients seal every edit in a secretEncryptedMessage envelope keyed by
	// this secret - null on rows mirrored before it was captured.
	wa_msg_secret: Uint8Array | null
}

// Mirror kinds stored in reply_map.tg_kind. Only WA→TG rows carry a real
// kind; TG→WA rows keep 'unknown'.
export type MirrorKind = 'text' | 'media' | 'sticker' | 'special' | 'unknown'

function toMapping(row: Record<string, unknown>): MappingRow {
	return {
		whatsapp_jid: row.whatsapp_jid as string,
		telegram_topic_id: row.telegram_topic_id as number,
		display_name: row.display_name as string,
		chat_type: row.chat_type as '1:1' | 'group',
		created_at: row.created_at as number,
		last_active_at: row.last_active_at as number,
		archived: Boolean(row.archived),
		muted: Boolean(row.muted ?? 0),
		telegram_chat_id: typeof row.telegram_chat_id === 'string' ? row.telegram_chat_id : '',
		bucket: row.bucket === 'personal' || row.bucket === 'business' ? row.bucket : 'undecided',
		prompt_msg_id: typeof row.prompt_msg_id === 'number' ? row.prompt_msg_id : null,
	}
}

export class BridgeDB {
	private db: DatabaseSync

	constructor(path: string = 'conf/gen/bridge.db') {
		const dir = path.split('/').slice(0, -1).join('/')
		if (dir) {
			try {
				Deno.statSync(dir)
			} catch {
				Deno.mkdirSync(dir, { recursive: true })
			}
		}
		this.db = new DatabaseSync(path)
		this.db.exec('PRAGMA journal_mode = WAL')
		// The bulk script opens this same file while the bot relays - wait
		// on a locked write instead of throwing SQLITE_BUSY immediately.
		this.db.exec('PRAGMA busy_timeout = 5000')
	}

	init(legacyChatId = ''): void {
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS mappings (
				whatsapp_jid TEXT PRIMARY KEY,
				telegram_topic_id INTEGER NOT NULL,
				display_name TEXT NOT NULL DEFAULT '',
				chat_type TEXT NOT NULL DEFAULT '1:1',
				created_at INTEGER NOT NULL,
				last_active_at INTEGER NOT NULL,
				archived INTEGER NOT NULL DEFAULT 0
			)
		`)
		this.db.exec('CREATE INDEX IF NOT EXISTS idx_telegram_topic ON mappings(telegram_topic_id)')
		this.db.exec('CREATE INDEX IF NOT EXISTS idx_archived ON mappings(archived)')
		// Maps a Telegram message back to the WhatsApp message it mirrors,
		// so Telegram replies can become WhatsApp quoted replies.
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS reply_map (
				tg_msg_id INTEGER PRIMARY KEY,
				wa_jid TEXT NOT NULL,
				wa_msg_id TEXT NOT NULL,
				wa_key_json TEXT NOT NULL DEFAULT '{}',
				created_at INTEGER NOT NULL
			)
		`)
		// Reverse direction: WhatsApp quotes reference the original by its
		// stanzaId (= wa_msg_id), so WA→TG needs this lookup to set
		// reply_parameters on the Telegram message.
		this.db.exec(
			'CREATE INDEX IF NOT EXISTS idx_reply_wa ON reply_map(wa_jid, wa_msg_id)',
		)
		// Mirror kind for the edit path (which TG endpoint to call). ADD
		// COLUMN is a no-op on DBs that already have it - safe to run every boot.
		const cols = this.db.prepare(`PRAGMA table_info(reply_map)`).all() as { name: string }[]
		if (!cols.some((c) => c.name === 'tg_kind')) {
			this.db.exec(`ALTER TABLE reply_map ADD COLUMN tg_kind TEXT NOT NULL DEFAULT 'unknown'`)
		}
		// Last relayed mirror content for revoke-as-spoiler. Nullable so
		// legacy rows and TG-originated rows simply have nothing stored.
		if (!cols.some((c) => c.name === 'tg_text')) {
			this.db.exec(`ALTER TABLE reply_map ADD COLUMN tg_text TEXT DEFAULT NULL`)
		}
		if (!cols.some((c) => c.name === 'tg_entities')) {
			this.db.exec(`ALTER TABLE reply_map ADD COLUMN tg_entities TEXT DEFAULT NULL`)
		}
		// Per-chat mute flag. Same safe-ADD pattern for existing DBs.
		const mapCols = this.db.prepare(`PRAGMA table_info(mappings)`).all() as { name: string }[]
		if (!mapCols.some((c) => c.name === 'muted')) {
			this.db.exec(`ALTER TABLE mappings ADD COLUMN muted INTEGER NOT NULL DEFAULT 0`)
		}
		// Dual-supergroup routing columns. Same safe-ADD pattern.
		if (!mapCols.some((c) => c.name === 'telegram_chat_id')) {
			this.db.exec(
				`ALTER TABLE mappings ADD COLUMN telegram_chat_id TEXT NOT NULL DEFAULT ''`,
			)
		}
		if (!mapCols.some((c) => c.name === 'bucket')) {
			this.db.exec(`ALTER TABLE mappings ADD COLUMN bucket TEXT NOT NULL DEFAULT 'undecided'`)
		}
		if (!mapCols.some((c) => c.name === 'prompt_msg_id')) {
			this.db.exec(`ALTER TABLE mappings ADD COLUMN prompt_msg_id INTEGER DEFAULT NULL`)
		}
		// Topic IDs collide across groups - every TG→WA lookup is (chat, topic).
		this.db.exec(
			'CREATE INDEX IF NOT EXISTS idx_chat_topic ON mappings(telegram_chat_id, telegram_topic_id)',
		)
		// Single-group DBs predate per-group reply identity: rebuild
		// reply_map with a composite (chat, message) key so message IDs from
		// the second group can never collide, plus the reply target used to
		// re-thread copied history on a topic move. Existing rows belong to
		// the legacy group, stamped via legacyChatId (boot backfills '' too).
		const replyCols = this.db.prepare(`PRAGMA table_info(reply_map)`).all() as {
			name: string
		}[]
		if (!replyCols.some((c) => c.name === 'tg_chat_id')) {
			this.db.exec(`
				CREATE TABLE reply_map_new (
					tg_chat_id TEXT NOT NULL DEFAULT '',
					tg_msg_id INTEGER NOT NULL,
					wa_jid TEXT NOT NULL,
					wa_msg_id TEXT NOT NULL,
					wa_key_json TEXT NOT NULL DEFAULT '{}',
					created_at INTEGER NOT NULL,
					tg_kind TEXT NOT NULL DEFAULT 'unknown',
					tg_text TEXT DEFAULT NULL,
					tg_entities TEXT DEFAULT NULL,
					tg_reply_to INTEGER DEFAULT NULL,
					PRIMARY KEY (tg_chat_id, tg_msg_id)
				)
			`)
			this.db.prepare(
				`INSERT INTO reply_map_new (tg_chat_id, tg_msg_id, wa_jid, wa_msg_id, wa_key_json, created_at, tg_kind, tg_text, tg_entities)
				 SELECT ?, tg_msg_id, wa_jid, wa_msg_id, wa_key_json, created_at, tg_kind, tg_text, tg_entities FROM reply_map`,
			).run(legacyChatId)
			this.db.exec(`DROP TABLE reply_map`)
			this.db.exec(`ALTER TABLE reply_map_new RENAME TO reply_map`)
			this.db.exec(
				'CREATE INDEX IF NOT EXISTS idx_reply_wa ON reply_map(wa_jid, wa_msg_id)',
			)
		} else if (!replyCols.some((c) => c.name === 'tg_reply_to')) {
			this.db.exec(`ALTER TABLE reply_map ADD COLUMN tg_reply_to INTEGER DEFAULT NULL`)
		}
		// Poll vote metadata (safe-ADD pattern for existing DBs).
		const pollCols = this.db.prepare(`PRAGMA table_info(reply_map)`).all() as {
			name: string
		}[]
		if (!pollCols.some((c) => c.name === 'wa_poll_secret')) {
			this.db.exec(`ALTER TABLE reply_map ADD COLUMN wa_poll_secret BLOB DEFAULT NULL`)
		}
		if (!pollCols.some((c) => c.name === 'wa_poll_options')) {
			this.db.exec(`ALTER TABLE reply_map ADD COLUMN wa_poll_options TEXT DEFAULT NULL`)
		}
		if (!pollCols.some((c) => c.name === 'wa_poll_creator')) {
			this.db.exec(`ALTER TABLE reply_map ADD COLUMN wa_poll_creator TEXT DEFAULT NULL`)
		}
		if (!pollCols.some((c) => c.name === 'tg_poll_id')) {
			this.db.exec(`ALTER TABLE reply_map ADD COLUMN tg_poll_id TEXT DEFAULT NULL`)
		}
		if (!pollCols.some((c) => c.name === 'wa_msg_secret')) {
			this.db.exec(`ALTER TABLE reply_map ADD COLUMN wa_msg_secret BLOB DEFAULT NULL`)
		}
		this.db.exec(
			'CREATE INDEX IF NOT EXISTS idx_reply_poll ON reply_map(tg_poll_id)',
		)
		// JID aliases: one contact can arrive as @lid or @s.whatsapp.net.
		// The alias table maps every seen variant to the canonical JID so
		// both variants resolve to the same topic instead of splitting.
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS jid_aliases (
				alias TEXT PRIMARY KEY,
				canonical TEXT NOT NULL
			)
		`)
		this.purgePoisonedAliases()
	}

	// Drop alias rows that mix chats with senders. A past wa-to-tg bug
	// stored group participant alts as chat aliases (user PN -> group) and
	// heal moves stored group -> user / group -> group. Only user-user
	// LID<->PN pairs are legitimate, so anything touching @g.us (or any
	// other non-user domain) is deleted. Runs every boot, returns the
	// number of rows removed.
	purgePoisonedAliases(): number {
		try {
			const res = this.db.prepare(
				`DELETE FROM jid_aliases WHERE NOT (
					(alias LIKE '%@lid' OR alias LIKE '%@s.whatsapp.net') AND
					(canonical LIKE '%@lid' OR canonical LIKE '%@s.whatsapp.net')
				)`,
			).run() as unknown as { changes?: unknown }
			const n = typeof res?.changes === 'number' ? res.changes : Number(res?.changes ?? 0)
			if (n > 0) {
				console.log(`[BRIDGE] purged ${n} poisoned jid_alias rows (group/sender mix)`)
			}
			return Number.isFinite(n) ? n : 0
		} catch {
			return 0
		}
	}

	close(): void {
		this.db.close()
	}

	getOrCreate(
		jid: string,
		topicId: number,
		displayName: string,
		chatType: '1:1' | 'group',
		chatId: string,
	): MappingRow {
		const existing = this.db
			.prepare('SELECT * FROM mappings WHERE whatsapp_jid = ?')
			.get(jid) as Record<string, unknown> | undefined

		if (existing) {
			this.db
				.prepare(
					'UPDATE mappings SET telegram_topic_id = ?, display_name = ?, archived = 0, last_active_at = ?, telegram_chat_id = ? WHERE whatsapp_jid = ?',
				)
				.run(topicId, displayName, Date.now(), chatId, jid)
			return {
				...toMapping(existing),
				telegram_topic_id: topicId,
				display_name: displayName,
				archived: false,
				last_active_at: Date.now(),
				telegram_chat_id: chatId,
			}
		}

		const row: MappingRow = {
			whatsapp_jid: jid,
			telegram_topic_id: topicId,
			display_name: displayName,
			chat_type: chatType,
			created_at: Date.now(),
			last_active_at: Date.now(),
			archived: false,
			muted: false,
			telegram_chat_id: chatId,
			bucket: 'undecided',
			prompt_msg_id: null,
		}

		this.db
			.prepare(
				'INSERT INTO mappings (whatsapp_jid, telegram_topic_id, display_name, chat_type, created_at, last_active_at, archived, telegram_chat_id, bucket) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
			)
			.run(
				row.whatsapp_jid,
				row.telegram_topic_id,
				row.display_name,
				row.chat_type,
				row.created_at,
				row.last_active_at,
				0,
				chatId,
				'undecided',
			)
		return row
	}

	getByJid(jid: string): MappingRow | undefined {
		const row = this.db.prepare('SELECT * FROM mappings WHERE whatsapp_jid = ?').get(jid) as
			| Record<string, unknown>
			| undefined
		if (!row) return undefined
		return toMapping(row)
	}

	// Alias-aware lookup: resolves @lid/@s.whatsapp.net variants to the
	// canonical mapping so one contact never gets two topics.
	getByJidOrAlias(jid: string): MappingRow | undefined {
		const direct = this.getByJid(jid)
		if (direct) return direct
		try {
			const link = this.db.prepare('SELECT canonical FROM jid_aliases WHERE alias = ?').get(
				jid,
			) as { canonical?: unknown } | undefined
			const canonical = typeof link?.canonical === 'string' ? link.canonical : null
			if (canonical && canonical !== jid) return this.getByJid(canonical)
		} catch {
			// Alias table missing on very old DBs before init() - direct miss.
		}
		return undefined
	}

	// Remember that an alias JID means the same chat as the canonical one.
	addAlias(alias: string, canonical: string): void {
		if (!alias || !canonical || alias === canonical) return
		try {
			this.db.prepare(
				'INSERT OR REPLACE INTO jid_aliases (alias, canonical) VALUES (?, ?)',
			).run(alias, canonical)
		} catch {
			// Best effort - a missing alias only risks a future dupe topic.
		}
	}

	// Move reply_map rows when a chat heals from an alias onto canonical.
	repointReplies(fromJid: string, toJid: string): void {
		if (!fromJid || !toJid || fromJid === toJid) return
		try {
			this.db.prepare('UPDATE reply_map SET wa_jid = ? WHERE wa_jid = ?').run(toJid, fromJid)
		} catch {
			// Best effort - stale rows just miss quote resolution.
		}
	}

	// Alias-aware reverse lookup: tries the canonical JID plus every known
	// variant, so quotes/edits/deletes resolve even for pre-migration rows.
	getByWaMsgIdAny(waMsgId: string, jids: string[]): ReplyMapRow | undefined {
		for (const jid of [...new Set(jids.filter(Boolean))]) {
			const row = this.getByWaMsgId(waMsgId, jid)
			if (row) return row
		}
		return undefined
	}

	// Group-scoped topic lookup: topic IDs collide across supergroups, so
	// every TG→WA path resolves (chat, topic) together.
	getByTopic(chatId: string, topicId: number): MappingRow | undefined {
		const row = this.db.prepare(
			'SELECT * FROM mappings WHERE telegram_chat_id = ? AND telegram_topic_id = ? AND archived = 0',
		).get(chatId, topicId) as Record<string, unknown> | undefined
		if (!row) return undefined
		return toMapping(row)
	}

	// Resolve a classification-button tap: the prompt message ID is stored
	// on the mapping because callback payloads are capped at 64 bytes.
	getByPrompt(chatId: string, msgId: number): MappingRow | undefined {
		const row = this.db.prepare(
			'SELECT * FROM mappings WHERE telegram_chat_id = ? AND prompt_msg_id = ? AND archived = 0',
		).get(chatId, msgId) as Record<string, unknown> | undefined
		if (!row) return undefined
		return toMapping(row)
	}

	setBucket(jid: string, bucket: Bucket): void {
		this.db.prepare('UPDATE mappings SET bucket = ? WHERE whatsapp_jid = ?').run(bucket, jid)
	}

	setPromptMsgId(jid: string, msgId: number | null): void {
		this.db.prepare('UPDATE mappings SET prompt_msg_id = ? WHERE whatsapp_jid = ?').run(
			msgId,
			jid,
		)
	}

	// Stamp rows that predate per-group identity (mappings + any reply rows
	// the init() rebuild missed with '') onto the legacy supergroup.
	backfillLegacyChat(chatId: string): void {
		if (!chatId) return
		this.db.prepare(`UPDATE mappings SET telegram_chat_id = ? WHERE telegram_chat_id = ''`).run(
			chatId,
		)
		try {
			this.db.prepare(`UPDATE reply_map SET tg_chat_id = ? WHERE tg_chat_id = ''`).run(chatId)
		} catch {
			// Pre-migration schema without tg_chat_id - init() rebuilds it.
		}
	}

	getAllActive(): MappingRow[] {
		return (this.db.prepare('SELECT * FROM mappings WHERE archived = 0').all() as Record<
			string,
			unknown
		>[]).map(toMapping)
	}

	getAll(): MappingRow[] {
		return (this.db.prepare('SELECT * FROM mappings').all() as Record<string, unknown>[]).map(
			toMapping,
		)
	}

	archive(jid: string): void {
		this.db.prepare('UPDATE mappings SET archived = 1 WHERE whatsapp_jid = ?').run(jid)
	}

	unarchive(jid: string): void {
		this.db.prepare('UPDATE mappings SET archived = 0 WHERE whatsapp_jid = ?').run(jid)
	}

	setMuted(jid: string, muted: boolean): void {
		this.db.prepare('UPDATE mappings SET muted = ? WHERE whatsapp_jid = ?').run(
			muted ? 1 : 0,
			jid,
		)
	}

	delete(jid: string): void {
		this.db.prepare('DELETE FROM mappings WHERE whatsapp_jid = ?').run(jid)
	}

	updateLastActive(jid: string): void {
		this.db.prepare('UPDATE mappings SET last_active_at = ? WHERE whatsapp_jid = ?').run(
			Date.now(),
			jid,
		)
	}

	private lastReplyPrune = 0

	saveReplyMap(
		tgMsgId: number,
		waJid: string,
		waMsgId: string,
		waKeyJson: string,
		tgKind: MirrorKind = 'unknown',
		tgText: string | null = null,
		tgEntitiesJson: string | null = null,
		opts: { chatId: string; replyTo?: number | null },
	): void {
		this.db
			.prepare(
				'INSERT OR REPLACE INTO reply_map (tg_chat_id, tg_msg_id, wa_jid, wa_msg_id, wa_key_json, tg_kind, tg_text, tg_entities, tg_reply_to, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
			)
			.run(
				opts.chatId ?? '',
				tgMsgId,
				waJid,
				waMsgId,
				waKeyJson,
				tgKind,
				tgText,
				tgEntitiesJson,
				opts.replyTo ?? null,
				Date.now(),
			)
		// keep the table small: prune 7-day rows at most once per hour
		const now = Date.now()
		if (now - this.lastReplyPrune > 60 * 60 * 1000) {
			this.lastReplyPrune = now
			this.db.prepare(
				'DELETE FROM reply_map WHERE created_at < ?',
			).run(now - 7 * 24 * 60 * 60 * 1000)
		}
	}

	// Poll metadata for a mirrored WA poll - messageSecret (vote crypto),
	// ordered option names (TG answers carry indexes), creator JID (vote
	// signature) and the Telegram poll id. Runs right after the native
	// sendPoll mirror so votes in either direction resolve.
	savePollMeta(
		tgChatId: string,
		tgMsgId: number,
		meta: {
			secret: Uint8Array | null
			options: string[]
			creator: string
			pollId: string | null
		},
	): void {
		this.db.prepare(
			'UPDATE reply_map SET wa_poll_secret = ?, wa_poll_options = ?, wa_poll_creator = ?, tg_poll_id = ? WHERE tg_chat_id = ? AND tg_msg_id = ?',
		).run(
			meta.secret ? Buffer.from(meta.secret) : null,
			JSON.stringify(meta.options),
			meta.creator || null,
			meta.pollId,
			tgChatId,
			tgMsgId,
		)
	}

	// Original messageSecret for a mirrored message - decrypts later
	// secretEncryptedMessage (MESSAGE_EDIT) envelopes sealed against it.
	// Skips nulls so rows mirrored before capture keep nothing.
	saveMsgSecret(tgChatId: string, tgMsgId: number, secret: Uint8Array | null): void {
		if (!secret) return
		try {
			this.db.prepare(
				'UPDATE reply_map SET wa_msg_secret = ? WHERE tg_chat_id = ? AND tg_msg_id = ?',
			).run(Buffer.from(secret), tgChatId, tgMsgId)
		} catch {
			// Best effort - a missing secret only loses encrypted edits.
		}
	}

	// Reverse lookup for Telegram poll answers: poll_answer updates carry
	// the bot poll id but no chat, so the id alone resolves the WA poll.
	getReplyMapByPollId(pollId: string): ReplyMapRow | undefined {
		if (!pollId) return undefined
		const row = this.db.prepare(
			'SELECT * FROM reply_map WHERE tg_poll_id = ?',
		).get(pollId) as Record<string, unknown> | undefined
		if (!row) return undefined
		return row as unknown as ReplyMapRow
	}

	// Group-scoped reply lookup: message IDs collide across supergroups.
	getReplyMapAt(chatId: string, tgMsgId: number): ReplyMapRow | undefined {
		const row = this.db.prepare(
			'SELECT * FROM reply_map WHERE tg_chat_id = ? AND tg_msg_id = ?',
		).get(chatId, tgMsgId) as Record<string, unknown> | undefined
		if (!row) return undefined
		return row as unknown as ReplyMapRow
	}

	// Newest-first history window for a topic move replay (caller reverses
	// to chronological before copying).
	recentReplyMaps(waJid: string, limit: number): ReplyMapRow[] {
		try {
			return this.db.prepare(
				'SELECT * FROM reply_map WHERE wa_jid = ? ORDER BY created_at DESC, tg_msg_id DESC LIMIT ?',
			).all(waJid, limit) as unknown as ReplyMapRow[]
		} catch {
			return []
		}
	}

	// Rewrite a reply row onto its copied message after a topic move.
	moveReplyMap(chatId: string, oldTgId: number, newChatId: string, newTgId: number): void {
		this.db.prepare(
			'UPDATE reply_map SET tg_chat_id = ?, tg_msg_id = ? WHERE tg_chat_id = ? AND tg_msg_id = ?',
		).run(newChatId, newTgId, chatId, oldTgId)
	}

	// Drop a reply_map row scoped to its group (used after a successful
	// delete sync so later edits/reactions targeting the deleted message
	// don't 400).
	deleteReplyMapAt(chatId: string, tgMsgId: number): void {
		this.db.prepare('DELETE FROM reply_map WHERE tg_chat_id = ? AND tg_msg_id = ?').run(
			chatId,
			tgMsgId,
		)
	}

	// Reverse lookup for the WA→TG direction: given the quoted stanzaId from
	// a WhatsApp message's contextInfo, find the Telegram message that
	// mirrors the original. Scoped by chat because stanzaIds are only
	// unique per chat.
	getByWaMsgId(waMsgId: string, waJid: string): ReplyMapRow | undefined {
		const row = this.db.prepare(
			'SELECT * FROM reply_map WHERE wa_msg_id = ? AND wa_jid = ?',
		).get(waMsgId, waJid) as Record<string, unknown> | undefined
		if (!row) return undefined
		return row as unknown as ReplyMapRow
	}

	// In-memory echo guard for TG-initiated edits. A TG edit is forwarded to
	// WA as a protocol MESSAGE_EDIT, and the server echoes that protocol
	// message back as `messages.update` - without this guard the bridge
	// would "edit" the TG message to the text it already has (400: message
	// is not modified) on every TG-initiated edit. Marked synchronously
	// before the WA send; consumed when the echo arrives. Phone-side edits
	// of own messages are NOT marked, so they still mirror.
	private pendingTgEdits = new Set<string>()

	markTgEdit(waJid: string, waMsgId: string): void {
		if (this.pendingTgEdits.size > 1000) {
			const oldest = this.pendingTgEdits.values().next().value
			if (oldest !== undefined) this.pendingTgEdits.delete(oldest)
		}
		this.pendingTgEdits.add(`${waJid}\n${waMsgId}`)
	}

	takeTgEdit(waJid: string, waMsgId: string): boolean {
		const k = `${waJid}\n${waMsgId}`
		if (!this.pendingTgEdits.has(k)) return false
		this.pendingTgEdits.delete(k)
		return true
	}

	// In-memory echo guard for TG-initiated reactions. A TG reaction is
	// forwarded to WA via sendMessage({react}), and the server echoes that
	// react back as `messages.reaction` with fromMe=true - indistinguishable
	// from a genuine reaction made on the owner's own phone (the bridge
	// socket IS the owner's account, so those are fromMe too). A blanket
	// fromMe skip would drop all genuine own-phone reactions, so instead the
	// TG→WA send marks (jid, target, emoji) synchronously beforehand and the
	// WA→TG side consumes exactly one matching echo. Marked synchronously
	// before the WA send; unmarked reactions always relay.
	private pendingTgReacts = new Set<string>()

	markTgReact(waJid: string, waMsgId: string, emoji: string): void {
		if (this.pendingTgReacts.size > 1000) {
			const oldest = this.pendingTgReacts.values().next().value
			if (oldest !== undefined) this.pendingTgReacts.delete(oldest)
		}
		this.pendingTgReacts.add(`${waJid}\n${waMsgId}\n${emoji}`)
	}

	takeTgReact(waJid: string, waMsgId: string, emoji: string): boolean {
		const k = `${waJid}\n${waMsgId}\n${emoji}`
		if (!this.pendingTgReacts.has(k)) return false
		this.pendingTgReacts.delete(k)
		return true
	}

	// In-memory echo guard for TG-initiated poll votes. A TG vote is relayed
	// via relayMessage({pollUpdateMessage}), and the server echoes it back
	// as a fromMe pollUpdateMessage upsert - indistinguishable from a genuine
	// phone-side vote (same account). The TG side marks (jid, poll creation
	// id) beforehand and the WA side consumes exactly one matching echo.
	private pendingTgPollVotes = new Set<string>()

	markTgPollVote(waJid: string, waMsgId: string): void {
		if (this.pendingTgPollVotes.size > 1000) {
			const oldest = this.pendingTgPollVotes.values().next().value
			if (oldest !== undefined) this.pendingTgPollVotes.delete(oldest)
		}
		this.pendingTgPollVotes.add(`${waJid}\n${waMsgId}`)
	}

	takeTgPollVote(waJid: string, waMsgId: string): boolean {
		const k = `${waJid}\n${waMsgId}`
		if (!this.pendingTgPollVotes.has(k)) return false
		this.pendingTgPollVotes.delete(k)
		return true
	}

	// In-memory echo guard for TG-initiated pins. A TG pin is forwarded to
	// WA via sendMessage({pin}), and the server echoes it back as a
	// pinInChatMessage upsert with fromMe=true - indistinguishable from a
	// genuine pin made on the owner's own phone (the bridge socket IS the
	// owner's account, so those are fromMe too). The TG side marks (jid,
	// target) synchronously beforehand and the WA side consumes exactly one
	// matching echo. Marked synchronously before the WA send; unmarked pins
	// always relay.
	private pendingTgPins = new Set<string>()

	markTgPin(waJid: string, waMsgId: string): void {
		if (this.pendingTgPins.size > 1000) {
			const oldest = this.pendingTgPins.values().next().value
			if (oldest !== undefined) this.pendingTgPins.delete(oldest)
		}
		this.pendingTgPins.add(`${waJid}\n${waMsgId}`)
	}

	takeTgPin(waJid: string, waMsgId: string): boolean {
		const k = `${waJid}\n${waMsgId}`
		if (!this.pendingTgPins.has(k)) return false
		this.pendingTgPins.delete(k)
		return true
	}
}
