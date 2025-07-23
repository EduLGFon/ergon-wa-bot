import baileys, {
	AuthenticationCreds,
	AuthenticationState,
	BufferJSON,
	SignalDataTypeMap,
} from 'baileys'
import prisma from './prisma.js'
const {
	initAuthCreds,
	proto,
} = baileys

const authState = async (): Promise<
	{ state: AuthenticationState; saveCreds: () => Promise<void> }
> => {
	// Database operations replacing file operations with BufferJSON conversions
	const getData = async (key: string): Promise<any | null> => {
		const record = await prisma.authStorage.findUnique({ where: { key } })
		return record ? JSON.parse(JSON.stringify(record.data), BufferJSON.reviver) : null
	}

	const setData = async (key: string, data: any): Promise<void> => {
		const jsonData = JSON.parse(JSON.stringify(data, BufferJSON.replacer))
		await prisma.authStorage.upsert({
			where: { key },
			update: { data: jsonData },
			create: { key, data: jsonData },
		})
	}

	const removeData = async (key: string): Promise<void> => {
		await prisma.authStorage.deleteMany({ where: { key } })
	}

	const credsKey = 'creds'
	let creds: AuthenticationCreds = (await getData(credsKey)) ||
		initAuthCreds()
	if (!(await getData(credsKey))) {
		await setData(credsKey, creds)
	}

	return {
		state: {
			creds,
			keys: {
				get: async (type, ids) => {
					const data: {
						[_: string]: SignalDataTypeMap[typeof type]
					} = {}
					await Promise.all(
						ids.map(async (id) => {
							const key = `${type}-${id}`
							let value = await getData(key)
							if (type === 'app-state-sync-key' && value) {
								value = proto.Message.AppStateSyncKeyData
									.fromObject(value)
							}
							data[id] = value
						}),
					)
					return data
				},
				set: async (data) => {
					const tasks: Promise<void>[] = []
					for (const category in data) {
						const catData = data[category as keyof SignalDataTypeMap]
						for (const id in catData!) {
							const key = `${category}-${id}`
							const value = catData[id]
							tasks.push(
								value ? setData(key, value) : removeData(key),
							)
						}
					}
					await Promise.all(tasks)
				},
			},
		},
		saveCreds: async () => {
			return setData(credsKey, creds)
		},
	}
}

export default authState
