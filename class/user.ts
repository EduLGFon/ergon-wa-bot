import defaults from 'defaults' with { type: 'json' }
import db, { getUser } from 'db'
import { Content } from 'gemini'

export default class User {
	id!: num
	private _name!: str
	phone!: str
	private _telegram?: num
	private _lang!: str
	private _prefix!: str
	cmds!: num
	delay!: num
	memories!: str[]
	gemini!: Content[]

	constructor(data: { id?: num; phone?: str; name?: str; telegram?: num }) {
		this.fetchData(data)
	}
	fetchData(data: Partial<UserSchema>) {
		const db = getUser(data) // get user data from database by id or phone
		this.id = db.id!
		this._name = db.name || 'user'
		this.phone = db.phone!
		this._lang = db.lang || defaults.lang
		this._prefix = db.prefix || defaults.prefix
		this.cmds = db.cmds || 0
		this.delay = 0 // delay for anti-flood
		this.memories = JSON.parse(db.memories || '[]') // array of Gemini memories
		this.gemini = [] // array of Gemini messages

		// if name is different from database, update it
		if (data.name && data.name !== db.name) this.name = data.name
	}

	get name() {
		return this._name
	}

	set name(value: str) { // user.name = 'new user name'; then update database
		this._name = value

		// Update the user's name in the database
		db.query('update users set name = :name where id = :id', {
			id: this.id,
			name: value,
		})
		return
	}

	get lang() {
		return this._lang
	}

	set lang(value: str) { // user.lang = 'new user lang'; then update database
		this._lang = value

		// Update the user's language in the database
		db.query('update users set lang = :lang where id = :id', {
			id: this.id,
			lang: value,
		})
		return
	}

	get prefix() {
		return this._prefix
	}

	set prefix(value: str) { // user.prefix = 'new user prefix'; then update database
		this._prefix = value

		// Update the user's prefix in the database
		db.query('update users set prefix = :prefix where id = :id', {
			id: this.id,
			prefix: value,
		})
		return
	}

	get telegram() {
		return this._telegram || -1
	}

	set telegram(value: num) { // user.telegram = telegram thread id; then update database
		this._telegram = value

		// Update the user's telegram in the database
		db.query('update users set telegram = :telegram where id = :id', {
			id: this.id,
			telegram: value,
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
