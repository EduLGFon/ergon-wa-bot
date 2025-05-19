import defaults from 'defaults' with { type: 'json' }
import { Buffer } from 'node:buffer'
import { DateTime } from 'luxon'
import User from 'class/user.ts'
import Cmd from 'class/cmd.ts'
import db from 'plugin/db.ts'
import { Message } from 'wa'
import bot from 'main'

export { checkPerms, createMemories, delay, getMedia, now, sendOrEdit, toBase64 }

async function getMedia(msg: Message) {
	const target = msg.hasMedia ? msg : (msg.hasQuotedMsg ? await msg.getQuotedMessage() : null)

	if (!target || !target.hasMedia) return
	const media = await target.downloadMedia()
	if (!media) return

	return {
		data: media.data,
		mime: media.mimetype,
		target,
	}
}

function toBase64(buffer: Uint8Array) {
	return Buffer.from(buffer).toString('base64')
}

async function sendOrEdit(data: { msg: Message }, chat: str, text: str) {
	// @ts-ignore Checking if the message was sent
	if (data.msg?.id) {
		await data.msg.edit(text).catch((e) => console.log('Failed to edit message', e))
	} else data.msg = await bot.sendMessage(chat, text)
}

// checkPerms: check cmd permissions like block random guys from using eval
function checkPerms(cmd: Cmd, user: User, msg: Message) {
	const isDev = defaults.devs.includes(user.phone)
	// if a normal user tries to run a only-for-devs cmd

	if (cmd.access.restrict && !isDev) return 'prohibited'

	if (msg.id.remote.includes('@g.us')) { // if msg chat is a group
		if (!cmd.access.groups) return 'block'

		// to do: add admins check
		// const admins = group.members.map((m) => m.admin && m.id)
		// // all group admins id

		// if (cmd.access.admin && (!admins.includes(user.chat) && !isDev)) {
		// 	return 'prohibited' // Devs can use admin cmds for security reasons
		// }
	} else if (!cmd.access.dm) return 'block'
	// if there's no group and cmd can't run on DM

	return true
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
