import {
	type AuthenticationState,
	BufferJSON,
	initAuthCreds,
	proto,
	type SignalDataTypeMap,
} from 'baileys'
import { authCreds, authKey } from '@conf/schema.ts'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@db'

/** PostgreSQL auth strategy
 * it is used if you setted 'DATABASE_URL' env var
 * if you don't have a DB, file system auth storing
 * will be used instead
 */

const toStorableJson = (value: unknown) => JSON.parse(JSON.stringify(value, BufferJSON.replacer))

const fromStorableJson = <T = any>(value: unknown | null): T | null => {
	if (value == null) return null
	return JSON.parse(JSON.stringify(value), BufferJSON.reviver) as T
}

const postgresAuthState = async (
	session: str,
): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> => {
	const writeCreds = async (data: any) => {
		const json = toStorableJson(data)
		await db?.insert(authCreds).values({ session, data: json }).onConflictDoUpdate({
			target: authCreds.session,
			set: { data: json },
		})
	}

	const readCreds = async () => {
		const rows = await db?.select().from(authCreds).where(eq(authCreds.session, session))
		return fromStorableJson(rows?.[0]?.data)
	}

	let creds = await readCreds()
	if (!creds) {
		creds = initAuthCreds()
		await writeCreds(creds)
	}

	return {
		state: {
			creds,
			keys: {
				get: async (type, ids) => {
					if (!ids[0]) {
						print('AUTHSTATE', 'no IDs', 'red')
						print(type, ids)
						return {}
					}
					const rows = (await db?.select().from(authKey).where(
						and(
							eq(authKey.session, session),
							eq(authKey.category, type),
							inArray(authKey.key, ids),
						),
					)) || []

					const data: { [_: string]: SignalDataTypeMap[typeof type] } = {}
					await Promise.all(
						ids.map((id) => {
							let value = fromStorableJson(
								rows.find((r) => r.key === id && r.category === type)?.data,
							)
							if (type === 'app-state-sync-key' && value) {
								value = proto.Message.AppStateSyncKeyData.create(value)
							}
							data[id] = value
						}),
					)

					return data
				},
				set: async (data) => {
					const tasks: any[] = []

					for (const category in data) {
						const catData = data[category as keyof SignalDataTypeMap]
						for (const key in catData!) {
							const value = catData[key]
							const json = toStorableJson(value)

							if (value) {
								tasks.push(
									db?.insert(authKey).values({
										session,
										category,
										key,
										data: json,
									}).onConflictDoUpdate({
										target: [authKey.session, authKey.category, authKey.key],
										set: { data: json },
									}),
								)
							} else {
								tasks.push(
									db?.delete(authKey).where(
										and(
											eq(authKey.session, session),
											eq(authKey.category, category),
											eq(authKey.key, key),
										),
									),
								)
							}
						}
					}
					await Promise.all(tasks)
					return
				},
			},
		},
		saveCreds: async () => {
			await writeCreds(creds)
		},
	}
}

export default postgresAuthState
