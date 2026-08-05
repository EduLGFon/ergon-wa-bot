import {
	index,
	integer,
	json,
	pgTable,
	primaryKey,
	serial,
	timestamp,
	varchar,
} from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
	id: serial('id').primaryKey(),
	lid: varchar('lid').unique().notNull(),
	name: varchar('name'),
	memories: varchar('memories'),
	lang: varchar('lang'),
	prefix: varchar('prefix'),
	cmds: integer('cmds'),
})

export const msgs = pgTable(
	'msgs',
	{
		author: integer('author').notNull(),
		group: varchar('group').notNull(),
		count: integer('count').default(1).notNull(),
	},
	(table) => {
		return {
			pk: primaryKey({ columns: [table.author, table.group] }),
		}
	},
)

export const authStorage = pgTable('authStorage', {
	key: varchar('key').primaryKey(),
	data: json('data').notNull(),
})

export const authCreds = pgTable('authCreds', {
	session: varchar('session').primaryKey(),
	data: json('data').notNull(),
	createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).$onUpdate(() => new Date())
		.notNull(),
})

export const authKey = pgTable(
	'authKey',
	{
		session: varchar('session').notNull(),
		category: varchar('category').notNull(),
		key: varchar('key').notNull(),
		data: json('data'),
		createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).defaultNow().notNull(),
		updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).$onUpdate(() =>
			new Date()
		).notNull(),
	},
	(table) => {
		return {
			pk: primaryKey({ columns: [table.session, table.category, table.key] }),
			sessionCategoryIdx: index('session_category_idx').on(table.session, table.category),
		}
	},
)
