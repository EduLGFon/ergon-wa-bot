import defaults from 'defaults' with { type: 'json' }
import db, { getUser } from 'db'

export default class User {
	id: num
	username: str
	phone: str
	language: str
	cmdPrefix: str
	cmds: num
	delay: num
	data?: Partial<User>

	constructor(data: { id?: num; phone?: str }) {
		this.data = getUser(data) // get user data from database by id or phone
		this.id = this.data.id!
		this.username = this.data.name || 'user'
		this.phone = this.data.phone!
		this.language = this.data.lang || defaults.lang
		this.cmdPrefix = this.data.prefix || defaults.prefix
		this.cmds = this.data.cmds || 0
		this.delay = 0 // delay for anti-flood

		delete this.data // delete redundant data
	}

	get name() {
		return this.username
	}

	set name(value: str) { // user.name = 'new user name'; then update database
		this.username = value

		// Update the user's name in the database
		db.query('update users set name = :name where id = :id', {
			id: this.id,
			name: value,
		})
		return
	}

	get lang() {
		return this.language
	}

	set lang(value: str) { // user.lang = 'new user lang'; then update database
		this.language = value

		// Update the user's language in the database
		db.query('update users set lang = :lang where id = :id', {
			id: this.id,
			lang: value,
		})
		return
	}

	get prefix() {
		return this.cmdPrefix
	}

	set prefix(value: str) { // user.prefix = 'new user prefix'; then update database
		this.cmdPrefix = value

		// Update the user's prefix in the database
		db.query('update users set prefix = :prefix where id = :id', {
			id: this.id,
			prefix: value,
		})
		return
	}

	addCmd() { // add 1 to user's command count
		this.cmds++

		// Update the user's command count in the database
		db.query('update users set cmds = cmds + 1 where id = :id', {
			id: this.id,
		})
		return
	}
}
