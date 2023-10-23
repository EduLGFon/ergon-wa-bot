import config from '../JSON/config.json' assert { type: 'json' };
import prisma from '../Components/Prisma.js';

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
			await prisma.users.upsert({
				create: {
					id: this.id,
					lang: value,
					prefix: this._userPrefix,
					cmds: this._cmdsCount,
				},
				update: {
					lang: value,
				},
				where: { id: this.id },
			}))();
	}

	get prefix() {
		return this._userPrefix;
	}

	set prefix(value: str) {
		this._userPrefix = value;

		(async () =>
			prisma.users.upsert({
				create: {
					id: this.id,
					lang: this._userLanguage,
					prefix: value,
					cmds: this._cmdsCount,
				},
				update: {
					prefix: value,
				},
				where: { id: this.id },
			}))();
	}

	get cmds() {
		return this._cmdsCount;
	}

	async addCmd() {
		this._cmdsCount++;

		return await prisma.users.upsert({
			where: { id: this.id },
			create: {
				id: this.id,
				lang: this._userLanguage,
				prefix: this._userPrefix,
				cmds: 1,
			},
			update: {
				cmds: {
					increment: 1,
				},
			},
		});
	}

	async checkData() {
		let data = await prisma.users.findUnique({ where: { id: this.id } });

		if (!data) {
			data = await prisma.users.create({
				data: {
					id: this.id,
					lang: this._userLanguage,
					prefix: this._userPrefix,
					cmds: this._cmdsCount,
				},
			});
		}

		this._userLanguage = data.lang;
		this._userPrefix = data.prefix;
		this._cmdsCount = data.cmds;

		return this;
	}
}
