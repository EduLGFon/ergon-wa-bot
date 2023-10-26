import config from '../JSON/config.json' assert { type: 'json' };
import pg from '../Components/PostgreSQL.js';

export default class User {
	name: str;
	_userLanguage: str;
	_userPrefix: str;
	_cmdsCount: num;

	constructor(public id: str, username: str) {
		this.id = id;
		this.name = username;

		this._userLanguage = config.LANG;
		this._userPrefix = config.PREFIX;
		this._cmdsCount = 0;
	}
	public get lang() {
		return this._userLanguage;
	}

	public set lang(value: str) {
		this._userLanguage = value;

		(async () =>
			await pg.users.update({
				id: this.id,
				data: {
					lang: value,
				},
				createIfNull: true,
			}))();
	}

	get prefix() {
		return this._userPrefix;
	}

	set prefix(value: str) {
		this._userPrefix = value;

		(async () =>
			pg.users.update({
				id: this.id,
				data: { prefix: value },
				createIfNull: true,
			}))();
	}

	get cmds() {
		return this._cmdsCount;
	}

	async addCmd() {
		this._cmdsCount++;

		return await pg.users.update({
			id: this.id,
			data: {
				cmds: this.cmds + 1,
			},
		});
	}

	async checkData() {
		let data = await pg.users.find({ id: this.id }) as User;

		if (!data) {
			data = await pg.users.create({
				id: this.id,
				data: {
					lang: this._userLanguage,
					prefix: this._userPrefix,
					cmds: 0,
				},
			}) as User;
		}

		this._userLanguage = data.lang;
		this._userPrefix = data.prefix;
		this._cmdsCount = data.cmds;

		return this;
	}
}
