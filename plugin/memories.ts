import { prisma, User } from '../map.js'

export { cleanMemories, createMemories }
const memoryRegex = /{MEMORY:.+}/gi

// createMemories: add memories to user
async function createMemories(user: User, msg: AIMsg) {
	const matches = msg.text.match(memoryRegex)
	if (!matches) return msg.text // no memories found

	for (const memory of matches) {
		const m = memory.split('MEMORY:')[1].slice(0, -1).trim() // get memory from {MEMORY:memory}
		
		// check if memory already exists
		if (m && !user.memories.includes(m)) {
			// it do not exist, so add it
			user.memories.push(m)
			msg.header += `- *🧠 Memória atualizada:* ${m.encode()}\n`
			// remove placeholder from text
			msg.text = msg.text.replace(memory, '')
			continue
		}
		msg.text = msg.text.replace(memory, `*🧠 Consultando memória: ${m.encode()}*`)
	}

	// update user in database
	await prisma.users.update({
		where: { id: user.id },
		data: { memories: JSON.stringify(user.memories) },
	})
	return
}

async function cleanMemories(user: User) {
	user.memories = []

	await prisma.users.update({
		where: { id: user.id },
		data: { memories: '' },
	})
	return
}
