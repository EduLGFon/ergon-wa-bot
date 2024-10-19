import { Content } from '@google/generative-ai'
import { db, prisma } from '../map.js'

export default class User {
	_username: str
	_userLanguage: str
	_userPrefix: str
	_cmdsCount: num
	geminiCtx: Content[] // gemini conversation history
	lastCmd: {
		time: num
		cmdReply?: str
	}

	constructor(public id: str, username: str) {
		this.id = id.split('@')[0].split(':')[0]
		this.lastCmd = { time: 0 }
		this.geminiCtx = []

		this._username = username
		this._userLanguage = db.userDefault.language
		this._userPrefix = db.userDefault.prefix
		this._cmdsCount = 0
	}

	// get name: get user name on cache
	public get name() {
		return this._username
	}

	// set name: update user name on cache and db
	public set name(value: str) {
		this._username = value
		;(async () =>
			await prisma.users.update({
				where: { id: this.id },
				data: { name: value },
			}))()
	}

	// get lang: get user language on cache
	public get lang() {
		return this._userLanguage
	}

	// set lang: update user language on cache and db
	public set lang(value: str) {
		this._userLanguage = value
		;(async () =>
			await prisma.users.update({
				where: { id: this.id },
				data: { lang: value },
			}))()
	}

	// get prefix: get prefix prefix on cache
	get prefix() {
		return this._userPrefix
	}

	// set prefix: update user prefix on cache and db
	set prefix(value: str) {
		this._userPrefix = value
		;(async () =>
			await prisma.users.update({
				where: { id: this.id },
				data: { prefix: value },
			}))()
	}

	// get cmds: get user cmds count
	get cmds() {
		return this._cmdsCount
	}

	// addCmd: +1 on user cmds count on cache and db
	async addCmd() {
		this.lastCmd = { time: Date.now() }
		this._cmdsCount++

		await prisma.users.update({
			where: { id: this.id },
			data: {
				cmds: { increment: 1 },
			},
		})
	}

	// checkData: sync user data on cache/db
	async checkData() {
		let data = await prisma.users.findUnique({
			where: { id: this.id }, // fetch it
		})

		if (!data) {
			data = await prisma.users.create({
				data: { // create a new user
					id: this.id,
					name: this._username, // default values
					lang: this._userLanguage,
					prefix: this._userPrefix,
					cmds: 0,
				},
			})
		}

		if (this._username && data.name !== this._username) {
			data = await prisma.users.update({
				where: { id: this.id },
				data: { // update user name for rank
					name: this._username,
				},
			})
		}

		// update cache
		this._username = data.name
		this._userLanguage = data.lang
		this._userPrefix = data.prefix
		this._cmdsCount = data.cmds

		return this
	}
}
