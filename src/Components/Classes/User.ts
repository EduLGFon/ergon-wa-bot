import { LANG, PREFIX } from '../../JSON/config.json';
import { Prisma } from '../Typings';

export default class User {
	name: string;
	prisma: Prisma;
	_userLanguage: string;
	_userPrefix: string;

	constructor(public id: string, name: string, prisma: Prisma) {
		this.id = id;
		this.name = name;
		this.prisma = prisma;
		this._userLanguage = LANG;
		this._userPrefix = PREFIX;
	}
	public get lang() {
		return this._userLanguage;
	}

	public set lang(value: string) {
		this._userLanguage = value;

		(async () =>
			await this.prisma.users.upsert({
				create: {
					id: this.id,
					lang: value,
					prefix: this._userPrefix,
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

	set prefix(value: string) {
		this._userPrefix = value;

		(async () =>
			this.prisma.users.upsert({
				create: {
					id: this.id,
					lang: this._userLanguage,
					prefix: value,
				},
				update: {
					prefix: value,
				},
				where: { id: this.id },
			}))();
	}

	async checkData() {
		let data = await this.prisma.users.findUnique({ where: { id: this.id } });

		if (!data) {
			data = await this.prisma.users.create({
				data: {
					id: this.id,
					lang: this._userLanguage,
					prefix: this._userPrefix,
				},
			});
		}

		this._userLanguage = data.lang;
		this._userPrefix = data.prefix;

		return this;
	}
}
