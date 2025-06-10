import { Collection, defaults, Msg, prisma } from '../map.js'
import { Content } from '@google/generative-ai'

export default class User {
	id: num
	phone: str
	warns: str[]

	_name: str
	_lang: str
	_prefix: str
	_cmdsCount: num

	geminiCtx: Content[] // gemini conversation history
	grok: { role: str; content: str }[]
	lastCmd: {
		delay: num
	}
	msgs: Collection<str, Msg>

	constructor(data: Partial<User>) {
		this.id = data.id || 0
		this.phone = (data.phone || '').parsePhone()
		this.warns = []

		this._name = data._name || 'name'
		this._cmdsCount = data._cmdsCount || 0
		this._prefix = data._prefix || defaults.prefix
		this._lang = data._lang || defaults.lang

		this.lastCmd = data.lastCmd || { delay: 0 }
		this.geminiCtx = data.geminiCtx || []
		this.grok = data.grok || []
		this.msgs = new Collection(defaults.cache.dmMsgs)

		this.msgs.iterate(data?.msgs)
	}

	// get chat: get user phone number on cache to send msgs
	public get chat() {
		return this.phone + '@s.whatsapp.net'
	}

	// get name: get user name on cache
	public get name() {
		return this._name
	}

	// set name: update user name on cache and db
	public set name(value: str) {
		value = value.slice(0, 25)

		this._name = value
		;(async () =>
			process.env.DATABASE_URL &&
			await prisma.users.update({
				where: { id: this.id },
				data: { name: value },
			}))()
	}

	// get lang: get user language on cache
	public get lang() {
		return this._lang
	}

	// set lang: update user language on cache and db
	public set lang(value: str) {
		value = value.slice(0, 2)

		this._lang = value
		;(async () =>
			process.env.DATABASE_URL &&
			await prisma.users.update({
				where: { id: this.id },
				data: { lang: value },
			}))()
	}

	// get prefix: get prefix prefix on cache
	get prefix() {
		return this._prefix
	}

	// set prefix: update user prefix on cache and db
	set prefix(value: str) {
		value = value.slice(0, 3)

		this._prefix = value
		;(async () =>
			process.env.DATABASE_URL &&
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
		this._cmdsCount++

		if (!process.env.DATABASE_URL) return
		await prisma.users.update({
			where: { id: this.id },
			data: {
				cmds: { increment: 1 },
			},
		})
	}

	// checkData: sync user data on cache/db
	async checkData() {
		try {
			let data = await prisma.users.findFirst({
				where: {
					OR: [
						{ phone: this.phone },
						{ id: this.id },
					],
				}, // fetch it
			})

			if (!data) {
				data = await prisma.users.create({
					data: { // create a new user
						phone: this.phone,
						name: this._name, // default values
						lang: this._lang,
						prefix: this._prefix,
					},
				})
			}

			// update cache
			this.id = data.id
			this.phone = data.phone
			this._name = data.name
			this._lang = data.lang
			this._prefix = data.prefix
			this._cmdsCount = data.cmds

			return this
		} catch (e) {
			if (!process.env.DATABASE_URL) return this

			print('CHECKUSERDATA ERROR', e, 'red')
			print('User data:', {
				phone: this.phone,
				id: this.id,
			})
			return
		}
	}
}
