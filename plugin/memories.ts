import { prisma, User } from '../map.js'

export { cleanMemories, createMemories }
const memoryRegex = /{MEMORY:( |)[a-z].+}/gi

// createMemories: add memories to user
async function createMemories(user: User, msg: AIMsg) {
	const matches = msg.text.match(memoryRegex)
	if (!matches) return msg.text // no memories found

	for (const memory of matches) {
		const m = memory.split(':')[1].slice(0, -1).trim() // get memory from {MEMORY:memory}
		// check if memory already exists
		if (!m || user.memories.includes(m)) continue

		// add memory to user
		user.memories.push(m)
		msg.text = msg.text.replace(memory, '') // remove memory from text
		msg.header += `- *🧠 Memória atualizada:* \`${m}\`\n`
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
