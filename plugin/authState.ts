import baileys, {
	type AuthenticationCreds,
	type AuthenticationState,
	BufferJSON,
	type SignalDataTypeMap,
} from 'baileys'
import type { PrismaPromise } from '@prisma/client'
import prisma from './prisma.js'

const { initAuthCreds, proto } = baileys

const toStorableJson = (value: unknown) => JSON.parse(JSON.stringify(value, BufferJSON.replacer))

const fromStorableJson = <T = any>(value: unknown | null): T | null => {
	if (value == null) return null
	return JSON.parse(JSON.stringify(value), BufferJSON.reviver) as T
}

const postgresAuthState = async (
	folder: string,
): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> => {
	const sessionId = folder

	const writeData = async (data: any, file: string) => {
		if (file === 'creds.json') {
			const json = toStorableJson(data)
			await prisma.baileysAuthCreds.upsert({
				where: { sessionId },
				create: { sessionId, data: json },
				update: { data: json },
			})
			return
		}

		const match = /^(.*?)-(.*)\.json$/.exec(file)
		if (!match) return
		const [, category, keyId] = match
		const json = toStorableJson(data)

		await prisma.baileysAuthKey.upsert({
			where: { sessionId_category_keyId: { sessionId, category, keyId } },
			create: { sessionId, category, keyId, data: json },
			update: { data: json },
		})
	}

	const readData = async (file: string) => {
		try {
			if (file === 'creds.json') {
				const row = await prisma.baileysAuthCreds.findUnique({ where: { sessionId } })
				return fromStorableJson(row?.data)
			}
			const match = /^(.*?)-(.*)\.json$/.exec(file)
			if (!match) return null
			const [, category, keyId] = match
			const row = await prisma.baileysAuthKey.findUnique({
				where: { sessionId_category_keyId: { sessionId, category, keyId } },
			})
			return fromStorableJson(row?.data)
		} catch {
			return null
		}
	}

	const removeData = async (file: string) => {
		try {
			if (file === 'creds.json') {
				await prisma.baileysAuthCreds.delete({ where: { sessionId } }).catch(() => {})
				return
			}
			const match = /^(.*?)-(.*)\.json$/.exec(file)
			if (!match) return
			const [, category, keyId] = match
			await prisma.baileysAuthKey
				.delete({ where: { sessionId_category_keyId: { sessionId, category, keyId } } })
				.catch(() => {})
		} catch {}
	}

	const creds: AuthenticationCreds = (await readData('creds.json')) || initAuthCreds()

	return {
		state: {
			creds,
			keys: {
				get: async (type, ids) => {
					if (!ids.length) return {}
					const rows = await prisma.baileysAuthKey.findMany({
						where: {
							sessionId,
							category: type as unknown as string,
							keyId: { in: ids },
						},
					})

					const out: { [_: string]: SignalDataTypeMap[typeof type] } = {}
					const map = new Map(rows.map((r) => [r.keyId, r.data]))
					for (const id of ids) {
						let value =
							fromStorableJson<SignalDataTypeMap[typeof type]>(map.get(id) ?? null) ??
								undefined
						if (type === 'app-state-sync-key' && value) {
							value = proto.Message.AppStateSyncKeyData.fromObject(
								value as any,
							) as any
						}
						out[id] = value as any
					}
					return out
				},
				set: async (data) => {
					const ops: PrismaPromise<any>[] = []

					for (const category in data) {
						const byId = (data as any)[category] as Record<string, any>
						for (const keyId in byId) {
							const value = byId[keyId]
							if (value) {
								const json = toStorableJson(value)
								ops.push(
									prisma.baileysAuthKey.upsert({
										where: {
											sessionId_category_keyId: {
												sessionId,
												category,
												keyId,
											},
										},
										create: { sessionId, category, keyId, data: json },
										update: { data: json },
									}),
								)
							} else {
								ops.push(
									prisma.baileysAuthKey.delete({
										where: {
											sessionId_category_keyId: {
												sessionId,
												category,
												keyId,
											},
										},
									}),
								)
							}
						}
					}

					if (ops.length) {
						try {
							await prisma.$transaction(ops)
						} catch (err) {
							if (
								!(err instanceof Error &&
									err.message.includes('Record to delete does not exist'))
							) {
								throw err
							}
						}
					}
				},
			},
		},
		saveCreds: async () => {
			await writeData(creds, 'creds.json')
		},
	}
}

export default postgresAuthState
