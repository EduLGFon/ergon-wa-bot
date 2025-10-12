import {
	type AuthenticationCreds,
	type AuthenticationState,
	BufferJSON,
	initAuthCreds,
	proto,
	type SignalDataTypeMap,
} from 'baileys'
import type { PrismaPromise } from '@prisma/client'
import prisma from './prisma.js'

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
		await prisma.authCreds.upsert({
			where: { session },
			create: { session, data: json },
			update: { data: json },
		})
	}

	const readCreds = async () => {
		const row = await prisma.authCreds.findUnique({ where: { session } })
		return fromStorableJson(row?.data)
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
					const rows = await prisma.authKey.findMany({
						where: {
							session,
							category: type,
							key: { in: ids },
						},
					})

					const data: { [_: string]: SignalDataTypeMap[typeof type] } = {}
					await Promise.all(
						ids.map(async (id) => {
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
					const tasks: PrismaPromise<any>[] = []

					for (const category in data) {
						const catData = data[category as keyof SignalDataTypeMap]
						for (const key in catData!) {
							const value = catData[key]
							const json = toStorableJson(value)

							if (value) {
								tasks.push(
									prisma.authKey.upsert({
										where: {
											session_category_key: {
												session,
												category,
												key,
											},
										},
										create: { session, category, key, data: json },
										update: { data: json },
									}),
								)
							} else {
								tasks.push(
									prisma.authKey.deleteMany({
										where: { session, category, key },
									}),
								)
							}
						}
					}
					await Promise.all(tasks)
					// if (tasks.length) {
					// 	await prisma.$transaction(tasks)
					// }
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
