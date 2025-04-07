import { Client, Message } from 'wa'
import User from 'class/user.ts'
import cache from 'cache'

export default async function (bot: Client, msg: Message) {
	if (!['chat', 'audio', 'ptt', 'image', 'video'].includes(msg.type)) return
	console.log('from', msg.from)
	console.log('to', msg.to)
	console.log('remote', msg.id.remote)

	const user = new User({
		phone: msg.author,
		// @ts-ignore akshually, this is a bug in the library
		name: msg._data.notifyName,
	})

	const args = msg.body.replace(user.prefix, '').trim().split(' ')
	const shift = args.shift()?.toLowerCase()
	if (!shift) return
	const cmd = cache.cmds.find((c) => c.name === shift || c.alias.includes(shift))

	if (!cmd) return

	cmd.run({ bot, msg, args, user })
}
