import defaults from '@conf/defaults.json' with { type: 'json' }
import { type Msg } from '@conf/types/types.d.ts'
import Collection from '@class/collection.ts'
import type { Content } from '@google/genai'
import { users } from '@conf/schema.ts'
import { eq } from 'drizzle-orm'
import { db } from '@db'

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

	constructor({ id, lid, name, cmds, prefix, lang, memories }: Partial<UserDB>) {
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
	public get name() {
		// get user name from cache
		return this._name
	}

	public set name(value: str) {
		// update user name
		this._name = value // on cache
		if (Deno.env.get('DATABASE_URL')) {
			// update it on DB too
			db?.update(users).set({ name: value }).where(eq(users.id, this.id))
				.catch((e) => print('USER', `Failed to update name for user ${this.id}:`, e, 'red'))
		}
	}

	public get lang() {
		// get user language from cache
		return this._lang
	}

	public set lang(value: str) {
		// update user language
		this._lang = value // on cache
		if (Deno.env.get('DATABASE_URL')) {
			// update it on DB too
			db?.update(users).set({ lang: value }).where(eq(users.id, this.id))
				.catch((e) => print('USER', `Failed to update lang for user ${this.id}:`, e, 'red'))
		}
	}

	get prefix() {
		// get user prefix from cache
		return this._prefix
	}

	set prefix(value: str) {
		// update user db
		this._prefix = value // on cache
		if (Deno.env.get('DATABASE_URL')) {
			// update it on DB too
			db?.update(users).set({ prefix: value }).where(eq(users.id, this.id))
				.catch((e) =>
					print('USER', `Failed to update prefix for user ${this.id}:`, e, 'red')
				)
		}
	}

	async addCmd() {
		// +1 on user cmds count
		this.cmds++ // on cache

		if (!Deno.env.get('DATABASE_URL')) return
		// update it on db
		const { sql } = await import('drizzle-orm')
		await db?.update(users).set({ cmds: sql`${users.cmds} + 1` }).where(eq(users.id, this.id))
	}
}
