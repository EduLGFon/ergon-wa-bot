import { react, send } from 'util/message.ts'
// import telegram from 'plugin/telegram.ts'
import { delay } from 'util/functions.ts'
import User from 'class/user.ts'
import { Message } from 'wa'
import cache from 'cache'

export default async function (msg: Message) {
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

	// if (user.telegram && msg.type === 'chat' && user.id !== 1) {
	// 	telegram.api.sendMessage(defaults.telegram.group, msg.body, { message_thread_id: user.telegram })
	// }

	// if (msg.hasQuotedMsg) {
	// 	const quoted = await msg.getQuotedMessage()
	// 	console.log(quoted.deviceType)
	// }
	if (!msg.body.startsWith(user.prefix)) return // ignore messages that don't start with the prefix
	/* * Command checking */
	const args = msg.body.replace(user.prefix, '').trim().split(' ') // cmd argments
	const shift = args.shift()?.toLowerCase() // cmd name

	if (!shift) return
	const cmd = cache.cmds.find((c) => c.name === shift || c.alias.includes(shift))
	// finding the command in the cache
	if (!cmd) return
	msg.to = msg.id.remote
	// small lib bug fix to make the bot send messages to the right chat

	/* * Permissions checking */
	const auth = cmd.checkPerms(user, msg)
	const reactOnMsg = react.bind(msg)
	if (auth !== true) return reactOnMsg(auth)
	// you got censored OOOOMAGAAAA

	/* * Cooldown checking */
	const now = Date.now()
	const cooldown = cmd.cooldown
	if (user.delay > now) {
		user.delay += cooldown
		const timeout = user.delay - now

		await msg.reply(
			`[🕓] - Tá com pressa? Você foi taxado em *${
				timeout.duration(true)
			}*, espera um pouquinho aí`,
		)
		// warns user about cooldown

		await delay(timeout)
		// wait until it gets finished
	} else user.delay = now + cooldown

	user.addCmd() // 1+ on user personal cmds count

	cmd.run({ msg, args, user, send: send.bind(msg.to), react: reactOnMsg })
		.catch((e: any) => msg.reply(`Erro: ${e.message || e}`) ?? console.error(e))
}
