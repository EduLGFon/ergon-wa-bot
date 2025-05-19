import { DB } from 'sqlite'

const db = new DB('conf/sqlite.db')

// Create database tables
db.execute(`
CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT,
    phone       TEXT UNIQUE NOT NULL,
    telegram    INTEGER UNIQUE,
	memories	TEXT DEFAULT '[]',
    lang        TEXT,
    prefix      TEXT,
    cmds        INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS msgs (
    author  INTEGER,
    chat	TEXT,
    num 	INTEGER DEFAULT 1,

    PRIMARY KEY (author, chat)
);
CREATE TABLE IF NOT EXISTS reminders (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    author  INTEGER,
    chat    TEXT,
    msg     TEXT,
    time    TEXT,
    status  INTEGER DEFAULT 0
);
    `)

export default db
export { createUser, getUser }

function createUser(user: Partial<UserSchema>) {
	db.query(
		`
    INSERT INTO users (name, phone, telegram, lang, prefix, cmds, memories)
    VALUES (:name, :phone, :telegram, :lang, :prefix, :cmds, :memories);`,
		user,
	)
	return
}

function getUser(user: Partial<UserSchema>): UserSchema {
	let data
	if (user.phone) {
		user.phone = user.phone.split(':')[0].split('@')[0]
		data =
			db.queryEntries('SELECT * FROM users WHERE phone = :phone;', { phone: user.phone })[0]
		if (!data) {
			createUser(user)
			data = getUser(user)
		}
	} else if (user.id) {
		data = db.queryEntries('SELECT * FROM users WHERE id = :id;', { id: user.id })[0]
	} else if (user.telegram) {
		data = db.queryEntries('SELECT * FROM users WHERE name = :name OR telegram = :telegram;', {
			name: user.name,
			telegram: user.telegram,
		})[0]
	}

	return data as UserSchema
}
