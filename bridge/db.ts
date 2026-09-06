import Database from 'better-sqlite3'
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

export class BridgeDB {
	private db: Database.Database

	constructor(path: string = 'conf/gen/bridge.db') {
		const dir = path.split('/').slice(0, -1).join('/')
		if (dir && !existsSync(dir)) {
			mkdirSync(dir, { recursive: true })
		}
		this.db = new Database(path)
		this.db.pragma('journal_mode = WAL')
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
		this.db.exec(`CREATE INDEX IF NOT EXISTS idx_telegram_topic ON mappings(telegram_topic_id)`)
		this.db.exec(`CREATE INDEX IF NOT EXISTS idx_archived ON mappings(archived)`)
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
			.get(jid) as MappingRow | undefined

		if (existing) {
			this.db
				.prepare(
					'UPDATE mappings SET last_active_at = ?, display_name = ? WHERE whatsapp_jid = ?',
				)
				.run(Date.now(), displayName, jid)
			return { ...existing, last_active_at: Date.now(), display_name: displayName }
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
				row.archived,
			)
		return row
	}

	getByJid(jid: string): MappingRow | undefined {
		return this.db.prepare('SELECT * FROM mappings WHERE whatsapp_jid = ?').get(jid) as
			| MappingRow
			| undefined
	}

	getByTopicId(topicId: number): MappingRow | undefined {
		return this.db.prepare(
			'SELECT * FROM mappings WHERE telegram_topic_id = ? AND archived = 0',
		).get(topicId) as MappingRow | undefined
	}

	getAllActive(): MappingRow[] {
		return this.db.prepare('SELECT * FROM mappings WHERE archived = 0').all() as MappingRow[]
	}

	getAll(): MappingRow[] {
		return this.db.prepare('SELECT * FROM mappings').all() as MappingRow[]
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
}
