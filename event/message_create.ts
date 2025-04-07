import { Client, Message } from 'wa'
import User from 'class/user.ts'
import cache from 'cache'

export default async function (bot: Client, msg: Message) {
	if (!['chat', 'audio', 'ptt', 'image', 'video'].includes(msg.type)) return
	console.info('author/from/to/remote', msg.author, msg.from, msg.to, msg.id.remote)

	const user = new User({
		phone: msg.author || msg.from,
		// @ts-ignore akshually, this is a bug in the library
		name: msg._data.notifyName,
	})

	if (!msg.body.startsWith(user.prefix)) return
	const args = msg.body.replace(user.prefix, '').trim().split(' ')
	const shift = args.shift()?.toLowerCase()
	if (!shift) return
	const cmd = cache.cmds.find((c) => c.name === shift || c.alias.includes(shift))

	if (!cmd) return
	msg.to = msg.id.remote

	cmd.run({ bot, msg, args, user })
}
