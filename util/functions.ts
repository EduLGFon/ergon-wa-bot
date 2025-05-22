import defaults from 'defaults' with { type: 'json' }
import { Buffer } from 'node:buffer'
import { DateTime } from 'luxon'
import User from 'class/user.ts'
import db from 'plugin/db.ts'

export { createMemories, delay, now, randomDelay, toBase64 }

async function randomDelay() {
	const timeout = 2 + Math.floor(Math.random() * 5)
	return await delay(timeout * 1000)
}

function toBase64(buffer: Uint8Array) {
	return Buffer.from(buffer).toString('base64')
}

// get 'now' date time formatted
function now(format = 'TT') {
	return DateTime.now()
		.setZone(defaults.timezone)
		.setLocale(defaults.lang)
		.toFormat(format) // TT = HOURS:MINITES:SECONDS
}

// delay: wait a few ms
async function delay(ms: num) {
	return await new Promise((resolve) => setTimeout(resolve, ms))
}

// createMemories: add memories to user
function createMemories(user: User, memories: str[]) {
	const textMemories = []
	for (const memory of memories) {
		const m = memory.split(':')[1].slice(0, -1) // get memory from {MEMORY:memory}
		// check if memory already exists
		if (!m || user.memories.includes(m)) continue

		// add memory to user
		user.memories.push(m)
		textMemories.push(`- *Memória adicionada: ${m}*`)
	}

	// update user in database
	db.query('update users set memories = :memories where id = :id;', {
		id: user.id,
		memories: JSON.stringify(user.memories),
	})

	return textMemories
}
