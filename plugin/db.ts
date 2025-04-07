import { DB } from 'sqlite'

const db = new DB('conf/sqlite.db')

// Create database tables
db.execute(`
CREATE TABLE IF NOT EXISTS users (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    name    TEXT,
    phone   TEXT UNIQUE NOT NULL,
    lang    TEXT,
    prefix  TEXT,
    cmds    INTEGER DEFAULT 0
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

type User = { id?: num; name?: str; phone?: str; lang?: str; prefix?: str }
function createUser(user: User) {
	db.query(
		`
    INSERT INTO users (name, phone, lang, prefix)
    VALUES (:name, :phone, :lang, :prefix);`,
		user,
	)
	return
}

function getUser(user: User): User {
	let data
	if (user.phone) {
		user.phone = user.phone.split('@')[0]
		data =
			db.queryEntries('SELECT * FROM users WHERE phone = :phone;', { phone: user.phone })[0]
		if (!data) {
			createUser(user)
			data = getUser(user)
		}
	} else data = db.queryEntries('SELECT * FROM users WHERE id = :id;', { id: user.id })[0]

	return data
}
