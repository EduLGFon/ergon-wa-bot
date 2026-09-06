import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync } from 'node:fs'

export interface MappingRow {
	whatsapp_jid: string
	telegram_topic_id: number
	display_name: string
	chat_type: '1:1' | 'group'
	created_at: number
	last_active_at: number
	archived: boolean
}

export interface ReplyMapRow {
	tg_msg_id: number
	wa_jid: string
	wa_msg_id: string
	wa_key_json: string
	created_at: number
}

function toMapping(row: Record<string, unknown>): MappingRow {
	return {
		whatsapp_jid: row.whatsapp_jid as string,
		telegram_topic_id: row.telegram_topic_id as number,
		display_name: row.display_name as string,
		chat_type: row.chat_type as '1:1' | 'group',
		created_at: row.created_at as number,
		last_active_at: row.last_active_at as number,
		archived: Boolean(row.archived),
	}
}

export class BridgeDB {
	private db: DatabaseSync

	constructor(path: string = 'conf/gen/bridge.db') {
		const dir = path.split('/').slice(0, -1).join('/')
		if (dir && !existsSync(dir)) {
			mkdirSync(dir, { recursive: true })
		}
		this.db = new DatabaseSync(path)
		this.db.exec('PRAGMA journal_mode = WAL')
	}

	init(): void {
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
	}

	close(): void {
		this.db.close()
	}

	getOrCreate(
		jid: string,
		topicId: number,
		displayName: string,
		chatType: '1:1' | 'group',
	): MappingRow {
		const existing = this.db
			.prepare('SELECT * FROM mappings WHERE whatsapp_jid = ?')
			.get(jid) as Record<string, unknown> | undefined

		if (existing) {
			this.db
				.prepare(
					'UPDATE mappings SET last_active_at = ?, display_name = ? WHERE whatsapp_jid = ?',
				)
				.run(Date.now(), displayName, jid)
			return { ...toMapping(existing), last_active_at: Date.now(), display_name: displayName }
		}

		const row: MappingRow = {
			whatsapp_jid: jid,
			telegram_topic_id: topicId,
			display_name: displayName,
			chat_type: chatType,
			created_at: Date.now(),
			last_active_at: Date.now(),
			archived: false,
		}

		this.db
			.prepare(
				'INSERT INTO mappings (whatsapp_jid, telegram_topic_id, display_name, chat_type, created_at, last_active_at, archived) VALUES (?, ?, ?, ?, ?, ?, ?)',
			)
			.run(
				row.whatsapp_jid,
				row.telegram_topic_id,
				row.display_name,
				row.chat_type,
				row.created_at,
				row.last_active_at,
				0,
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

	getByTopicId(topicId: number): MappingRow | undefined {
		const row = this.db.prepare(
			'SELECT * FROM mappings WHERE telegram_topic_id = ? AND archived = 0',
		).get(topicId) as Record<string, unknown> | undefined
		if (!row) return undefined
		return toMapping(row)
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

	delete(jid: string): void {
		this.db.prepare('DELETE FROM mappings WHERE whatsapp_jid = ?').run(jid)
	}

	updateLastActive(jid: string): void {
		this.db.prepare('UPDATE mappings SET last_active_at = ? WHERE whatsapp_jid = ?').run(
			Date.now(),
			jid,
		)
	}

	saveReplyMap(tgMsgId: number, waJid: string, waMsgId: string, waKeyJson: string): void {
		this.db
			.prepare(
				'INSERT OR REPLACE INTO reply_map (tg_msg_id, wa_jid, wa_msg_id, wa_key_json, created_at) VALUES (?, ?, ?, ?, ?)',
			)
			.run(tgMsgId, waJid, waMsgId, waKeyJson, Date.now())
		// keep the table small: only recent messages can be replied to anyway
		this.db.prepare(
			'DELETE FROM reply_map WHERE created_at < ?',
		).run(Date.now() - 7 * 24 * 60 * 60 * 1000)
	}

	getReplyMap(tgMsgId: number): ReplyMapRow | undefined {
		const row = this.db.prepare('SELECT * FROM reply_map WHERE tg_msg_id = ?').get(tgMsgId) as
			| Record<string, unknown>
			| undefined
		if (!row) return undefined
		return row as unknown as ReplyMapRow
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
}
