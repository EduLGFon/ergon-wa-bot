import pg from '../Components/PostgreSQL.js';

type SQLCmds = 'insert' | 'update' | 'select' | 'delete' | 'count';
type OrderBy = { key: str; type: 'ASC' | 'DESC' };

export default class Table<T> {
	table: str;
	PK: str;

	constructor(name: str, primaryKey: str) {
		this.table = name;
		this.PK = primaryKey;
	}

	async create(
		options: {
			id: str | str[];
			data?: Partial<T>;
			limit?: num;
			orderBy?: OrderBy;
		},
	): Promise<T | T[]> {
		const { id } = options;

		const sql = this._genSQL('insert', options);

		try {
			if (Array.isArray(id)) {
				for (const i in id) {
					const singleSql = sql.replace(String(id), id[i]);

					await pg.unsafe(singleSql);
				}
			} else await pg.unsafe(sql);

			return await this.find(options);
		} catch (e: any) {
			console.error(`PG/CREATE/${this.table}: ${sql}\n${e.stack}`);

			return {} as T;
		}
	}

	async update(
		options: { id: str | str[]; data: Partial<T>; createIfNull?: bool },
	): Promise<T | T[]> {
		const { id } = options;
		const sql = this._genSQL('update', options);

		try {
			if (Array.isArray(id)) {
				for (const i in id) {
					const singleSql = sql.replace(String(id), id[i]);

					await pg.unsafe(singleSql);
				}
			} else await pg.unsafe(sql);

			return await this.find(options);
		} catch (e: any) {
			console.error(`PG/UPDATE/${this.table}: ${sql}\n${e.stack}`);

			return {} as T;
		}
	}

	async find(
		options: {
			id: str | str[];
			createIfNull?: bool;
			indexKey?: str;
			limit?: number;
			orderBy?: OrderBy;
		},
	): Promise<T | T[]> {
		const { id, createIfNull } = options;

		const sql = this._genSQL('select', options);
		let search: T | T[] = [];

		try {
			if (Array.isArray(id)) {
				for (const i in id) {
					const singleSql = sql.replace(String(id), id[i]);
					const query = await pg.unsafe(singleSql);

					search.push((query[0] || {}) as T);
				}
			} else {
				const query = await pg.unsafe(`${sql}`);

				search = query[0] as T;
			}
		} catch (e: any) {
			console.error(`PG/FIND/${this.table}: ${sql}\n${e.stack}`);

			search = [] as T[];
		}

		if (isEmpty(search) && createIfNull) return await this.create({ id });

		return search;
	}

	async delete(options: { id: str | str[]; indexKey: str }): Promise<bool> {
		const { id } = options;

		const sql = this._genSQL('delete', options);

		try {
			if (!Array.isArray(id)) return await pg.unsafe(sql) && true;

			for (const i in id) {
				const singleSql = sql.replace(String(id), id[i]);

				await pg.unsafe(singleSql);
			}

			return true;
		} catch (e: any) {
			console.error(`PG/DELETE/${this.table}: ${sql}\n${e.stack}`);

			return false;
		}
	}

	async getAll(
		options?: { limit?: number; orderBy?: OrderBy },
	): Promise<T[]> {
		const sql = this._genSQL('select', options);

		try {
			const query = await pg.unsafe(sql);

			return query as unknown as T[];
		} catch (e: any) {
			console.error(`PG/GETALL/${this.table}: ${sql}\n${e.stack}`);

			return [];
		}
	}

	async count() {
		const sql = `SELECT COUNT (${this.PK}) FROM "${this.table}";`;

		try {
			const query = await pg.unsafe(sql);

			return query.count;
		} catch (e: any) {
			console.error(`PG/COUNT/${this.table}: ${sql}\n${e.stack}`);

			return 0;
		}
	}

	_genSQL(type: SQLCmds, options?: {
		id?: str | str[];
		data?: Partial<T>;
		indexKey?: str;
		limit?: num;
		orderBy?: OrderBy;
	}): str {
		const id: str | str[] = options?.id || '',
			data: Partial<T> = options?.data || {},
			indexKey = options?.indexKey || this.PK;

		let sql = '';
		let values: str | str[] = [];
		let keys = '';

		if (data) {
			if (type === 'update') {
				Object.entries(data)
					.forEach(([key, value]) => {
						if (typeof value !== 'string') value = String(value);
						else value = `'${value.replace(new RegExp(`'`, 'g'), `''`)}'`;

						return (values as str[]).push(`"${key}" = ${value}`);
					});

				values = values.join(', ');
			} else {
				Object.values(data).forEach((value) => {
					if (typeof value !== 'string') value = String(value);
					else value = `'${value.replace(new RegExp(`'`, 'g'), `''`)}'`;

					return (values as str[]).push(value as str);
				});
				keys = `, "${Object.keys(data).join('", "')}"`;
				values = `, ${values.join(', ')}`;
			}
		}

		switch (type) {
			case 'select':
				sql = `SELECT * FROM "${this.table}"`;
				break;
			case 'update':
				sql = `UPDATE "${this.table}"\nSET ${values}`;

				delete options!.limit;
				delete options!.orderBy;
				break;

			case 'insert':
				sql =
					`INSERT INTO "${this.table}" ("${this.PK}"${keys})\nVALUES ('${id}'${values})`;

				delete options!.id;
				delete options!.limit;
				delete options!.orderBy;
				break;
			case 'delete':
				sql = `DELETE FROM "${this.table}"`;

				delete options!.limit;
				delete options!.orderBy;
		}

		Object.entries(options || {}).forEach(([key, value]: [str, any]) => {
			switch (key) {
				case 'id':
					return sql += `\nWHERE "${indexKey}" = '${id}'`;
				case 'limit':
					return sql += `\nLIMIT ${value}`;
				case 'orderBy':
					return sql += `\nORDER BY ${value.key} ${value.type}`;
			}
		});

		return sql + ';';
	}
}

function isEmpty(value: unknown): boolean {
	if (Array.isArray(value)) {
		return value.length === 0 ||
			value.some((item) => item === undefined || isEmpty(item));
	} else if (typeof value === 'object') {
		return Object.keys(value!).length === 0;
		//|| Object.values(value!).some((item) => item === undefined || isEmpty(item));
	}

	return true;
}
