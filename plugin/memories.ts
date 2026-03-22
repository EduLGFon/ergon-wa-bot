import { prisma, User } from '../map.js'

export { cleanMemories, createMemories }
const memoryRegex = /{MEMORY:.+}/gi

async function createMemories(user: User, msg: AIMsg) {
	// add memories to user
	const matches = msg.text.match(memoryRegex)
	if (!matches) return msg.text // no memories found

	for (const memory of matches) {
		const m = memory.split('MEMORY:')[1].slice(0, -1).trim() // get memory from {MEMORY:memory}

		// check if memory already exists
		if (m && !user.memories.includes(m)) {
			// it does not exist, so add it
			user.memories.push(m)
			msg.header += `- *🧠 Memória atualizada:* ${m.encode()}\n`
			// remove placeholder from text
			msg.text = msg.text.replace(memory, '')
			continue
		}
		msg.text = msg.text.replace(memory, '') // remove placeholder from text
		msg.header += `*🧠 Memória ativada: ${m.encode()}*\n`
	}

	if (!process.env.DATABASE_URL) return
	await prisma.users.update({
		// update user memories in database
		where: { id: user.id },
		data: { memories: JSON.stringify(user.memories) },
	})
	return
}

async function cleanMemories(user: User) {
	user.memories = [] // delete all memories

	if (!process.env.DATABASE_URL) return
	await prisma.users.update({
		// delete it also on DB
		where: { id: user.id },
		data: { memories: '' },
	})
	return
}
