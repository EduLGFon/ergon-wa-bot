import { Collection, defaults, type Msg, prisma } from '../map.js'
import type { UserSchema } from '../conf/types/types.js'
import type { Content } from '@google/genai'

export default class User {
	id: num
	phone: str

	private _name: str
	private _lang: str
	private _prefix: str
	cmds: num
	delay: num

	memories: str[]
	gemini: Content[]
	msgs: Collection<str, Msg>

	constructor({ id, phone, name, cmds, prefix, lang, memories }: Partial<UserSchema>) {
		this.id = id!
		this.phone = phone!.parsePhone()

		this._name = name || 'user'
		this._lang = lang || defaults.lang
		this._prefix = prefix || defaults.prefix
		this.cmds = cmds || 0
		this.delay = 0

		this.msgs = new Collection(defaults.cache.dmMsgs)
		this.memories = JSON.parse(memories || '[]')
		this.gemini = []
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
		this._name = value
		;(async () =>
			process.env.DATABASE_URL &&
			await prisma.users.update({
				where: { id: this.id },
				data: { name: value },
			}))()
		return
	}

	// get lang: get user language on cache
	public get lang() {
		return this._lang
	}

	// set lang: update user language on cache and db
	public set lang(value: str) {
		this._lang = value
		;(async () =>
			process.env.DATABASE_URL &&
			await prisma.users.update({
				where: { id: this.id },
				data: { lang: value },
			}))()
		return
	}

	// get prefix: get prefix prefix on cache
	get prefix() {
		return this._prefix
	}

	// set prefix: update user prefix on cache and db
	set prefix(value: str) {
		this._prefix = value
		;(async () =>
			process.env.DATABASE_URL &&
			await prisma.users.update({
				where: { id: this.id },
				data: { prefix: value },
			}))()
		return
	}

	// addCmd: +1 on user cmds count on cache and db
	async addCmd() {
		this.cmds++

		if (!process.env.DATABASE_URL) return
		await prisma.users.update({
			where: { id: this.id },
			data: {
				cmds: { increment: 1 },
			},
		})
		return
	}
}
