import { restrictEmojis } from 'util/emojis.ts'
import { checkPerms } from 'util/functions.ts'
import { delay } from 'util/functions.ts'
import { Client, Message } from 'wa'
import User from 'class/user.ts'
import cache from 'cache'

export default async function (bot: Client, msg: Message) {
	// console.info(
	// 	'author/from/to/remote/type',
	// 	msg.author,
	// 	msg.from,
	// 	msg.to,
	// 	msg.id.remote,
	// 	msg.type,
	// )
	/* * Message checking */
	if (!['chat', 'audio', 'ptt', 'image', 'video'].includes(msg.type)) return
	if (msg.id.remote.includes('broadcast')) return // ignore broadcast messages

	const phone = msg.author || msg.from
	let user = cache.users.get(phone)
	if (!user) {
		user = new User({ phone })
		cache.users.add(user.phone, user)
	}
	// @ts-ignore akshually, this is a bug in the library
	user.name = msg._data.notifyName

	if (!msg.body.startsWith(user.prefix)) return
	/* * Command checking */
	const args = msg.body.replace(user.prefix, '').trim().split(' ')
	const shift = args.shift()?.toLowerCase()
	if (!shift) return
	const cmd = cache.cmds.find((c) => c.name === shift || c.alias.includes(shift))

	if (!cmd) return
	msg.to = msg.id.remote

	/* * Permissions checking */
	const auth = checkPerms(cmd, user, msg)
	if (auth !== true) return msg.react(restrictEmojis[auth])
	// you got censored OOOOMAGAAAA

	/* * Cooldown checking */
	const now = Date.now()
	const cooldown = cmd.cooldown
	if (user.delay > now) {
		user.delay += cooldown
		const timeout = user.delay - now

		await msg.reply('⚠️ ')
		// warns user about cooldown

		await delay(timeout)
		// wait until it gets finished
	} else user.delay = now + cooldown

	user.addCmd() // 1+ on user personal cmds count

	cmd.run({ bot, msg, args, user })
		.catch((e: any) => msg.reply(`Erro: ${e.message || e}`) ?? console.error(e))
}
