import { ChatSession } from '@google/generative-ai'
import { db, prisma } from '../map.js'

export default class User {
	_username: str
	_userLanguage: str
	_userPrefix: str
	_cmdsCount: num
	_chat?: ChatSession
	lastCmd: {
		time: num
		cmdReply?: str
	}

	constructor(public id: str, username: str) {
		this.id = id.split('@')[0].split(':')[0]
		this.lastCmd = { time: 0 }

		this._username = username
		this._userLanguage = db.userDefault.language
		this._userPrefix = db.userDefault.prefix
		this._cmdsCount = 0
	}

	public get name() {
		return this._username
	}

	public set name(value: str) {
		this._username = value
		;(async () =>
			await prisma.users.update({
				where: { id: this.id },
				data: { name: value },
			}))()
	}

	public get lang() {
		return this._userLanguage
	}

	public set lang(value: str) {
		this._userLanguage = value
		;(async () =>
			await prisma.users.update({
				where: { id: this.id },
				data: { lang: value },
			}))()
	}

	get prefix() {
		return this._userPrefix
	}

	set prefix(value: str) {
		this._userPrefix = value
		;(async () =>
			await prisma.users.update({
				where: { id: this.id },
				data: { prefix: value },
			}))()
	}

	get cmds() {
		return this._cmdsCount
	}

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

	async checkData() {
		let data = await prisma.users.findUnique({
			where: { id: this.id },
		})

		if (!data) {
			data = await prisma.users.create({
				data: {
					id: this.id,
					name: this._username,
					lang: this._userLanguage,
					prefix: this._userPrefix,
					cmds: 0,
				},
			})
		}

		if (this._username && data.name !== this._username) {
			data = await prisma.users.update({
				where: { id: this.id },
				data: {
					name: this._username,
				},
			})
		}

		this._username = data.name
		this._userLanguage = data.lang
		this._userPrefix = data.prefix
		this._cmdsCount = data.cmds

		return this
	}
}
