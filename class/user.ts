import { Collection, defaults, type Msg, prisma } from '../map.js'
import type { Content } from '@google/genai'

export default class User {
	id: num
	lid: str
	phone: str

	private _name: str
	private _lang: str
	private _prefix: str
	cmds: num
	delay: num

	memories: str[]
	gemini: Content[]
	msgs: Collection<str, Msg>

	constructor({ id, lid, name, cmds, prefix, lang, memories }: Partial<UserSchema>) {
		this.id = id!
		this.lid = lid!
		this.phone = lid!.parsePhone()

		this._name = name || 'user'
		this._lang = lang || defaults.lang
		this._prefix = prefix || defaults.prefix
		this.cmds = cmds || 0
		this.delay = 0

		this.msgs = new Collection(defaults.cache.dmMsgs)
		this.memories = JSON.parse(memories || '[]')
		this.gemini = []
	}
	public get name() { // get user name from cache
		return this._name
	}

	public set name(value: str) { // update user name
		this._name = value // on cache
		;(async () =>
			process.env.DATABASE_URL && // if there is a DB
			await prisma.users.update({ // update it on DB too
				where: { id: this.id },
				data: { name: value },
			}))()
		return
	}

	public get lang() { // get user language from cache
		return this._lang
	}

	public set lang(value: str) { // update user language
		this._lang = value // on cache
		;(async () =>
			process.env.DATABASE_URL && // if there is a DB
			await prisma.users.update({ // update it on DB too
				where: { id: this.id },
				data: { lang: value },
			}))()
		return
	}

	get prefix() { // get user prefix from cache
		return this._prefix
	}

	set prefix(value: str) { // update user db
		this._prefix = value // on cache
		;(async () =>
			process.env.DATABASE_URL && // if there is a DB
			await prisma.users.update({ // update it on DB too
				where: { id: this.id },
				data: { prefix: value },
			}))()
		return
	}

	async addCmd() { // +1 on user cmds count
		this.cmds++ // on cache

		if (!process.env.DATABASE_URL) return
		await prisma.users.update({ // update it on db
			where: { id: this.id },
			data: {
				cmds: { increment: 1 },
			},
		})
		return
	}
}
