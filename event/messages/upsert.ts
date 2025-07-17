import { deleteMessage, react, send, startTyping } from '../../util/messages.js'
import { CmdCtx, delay, getCtx } from '../../map.js'
import { getUser } from '../../plugin/prisma.js'
import { type proto } from 'baileys'
import { getFixedT } from 'i18next'
import bot from '../../wa.js'

// messages upsert event
export default async function (raw: { messages: proto.IWebMessageInfo[] }, event: str) {
	// raw.messages = []
	// print(inspect(raw, { depth: null }))

	// sometimes you can receive more then 1 message per trigger, so use for
	for (const m of raw.messages) {
		if (!m?.message) continue

		// get abstract msg obj
		const { msg, args, cmd, group, user } = await getCtx(m)
		if (!user || !msg) continue

		/* * Messages counting & storing */
		if (group) group.countMsg(user, msg) // count msgs with cool values for group msgs rank cmd
		else {
			const chat = await getUser({ phone: msg.chat })
			chat!.msgs.add(msg.key.id!, msg)
		}

		if (!cmd) continue
		// get locales function
		const t = getFixedT(user.lang)
		const reactToMsg = react.bind(msg)
		const sendMsg = send.bind(msg.chat)

		/* * Cmd permissions checking */
		const auth = cmd.checkPerms(msg, user, group)
		if (auth !== true) continue // you got censored OOOOMAGAAAA

		const ctx: CmdCtx = {
			group,
			args,
			user,
			bot,
			cmd,
			startTyping: startTyping.bind(msg.chat),
			send: sendMsg,
			react: reactToMsg,
			deleteMsg: deleteMessage.bind(msg),
			msg,
			t,
		}

		/* * Cooldown checking */
		const now = Date.now()
		if (user.delay > now) {
			user.delay += cmd.cooldown
			const timeout = user.delay - now

			if (user.delay - Date.now() < 10_000) {
				await sendMsg(t('events.cooldown', { time: timeout.duration(true) }))
				// warns user about cooldown
			}

			await delay(timeout)
			// wait until it gets finished
		} else user.delay = now + cmd.cooldown

		user.addCmd() // 1+ on user personal cmds count

		Promise.resolve(cmd.run!(ctx))
			.catch(async (e) => {
				print(`EVENT/${event}`, e, 'red')
				sendMsg(`[⚠️] ${e?.message || e}`)
				return
			})
	}
	return
}
