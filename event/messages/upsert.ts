import { reactToMsg, sendMsg, startTyping } from '../../util/msgAbstractions.ts'
import checkGroupAnnouncer from '../../plugin/groupAnnouncer.ts'
import { type CmdCtx, delay, getCtx } from '../../map.ts'
import { getUser } from '../../plugin/prisma.ts'
import cache from '../../plugin/cache.ts'
import { type proto } from 'baileys'
import { getFixedT } from 'i18next'

// messages upsert event
export default async function (raw: { messages: proto.IWebMessageInfo[] }, _event: str) {
	// sometimes you can receive more then 1 message per trigger, so use for
	for (const m of raw.messages) {
		if (!m?.message) continue

		// get abstract msg obj
		const { msg, args, cmd, group, user } = await getCtx(m)
		if (!user || !msg) continue
		if (process.env.SHOW_IDS) console.log(user.name, msg.text, group?.id || msg.chat, msg)
		// this is for dev purpouses like getting a group ID

		// poorly way to count globally msgs received by day
		const today = new Date().getDate()
		cache.metrics.msg[today] = !cache.metrics.msg[today] ? 1 : cache.metrics.msg[today] + 1

		/* * Messages counting & storing */
		if (!msg.isEdited) {
			// count msgs with valid types for group msgs rank cmd
			if (group) group.countMsg(msg).catch((e: Error) => print('UPSERT/countMsg', e.message, 'red'))
			else {
				const chat = await getUser({ lid: msg.chat })
				// store msgs for searching images on sticker cmd
				chat!.msgs.add(msg.key.id!, msg)
			}
		}

		if (!cmd) {
			await checkGroupAnnouncer(msg, user, group)
			// only non-cmd msgs can be announced
			continue
		}
		// poorly way to count globally msgs received by day
		cache.metrics.cmd[today] = !cache.metrics.cmd[today] ? 1 : cache.metrics.cmd[today] + 1

		// get locales function
		const t = getFixedT(user.lang)
		const react = reactToMsg.bind(msg)
		const send = sendMsg.bind(msg.chat)

		/* * Cmd permissions checking */
		const auth = cmd.checkPerms(msg, user, group)
		if (auth !== true) continue // you got censored OOOOMAGAAAA

		const ctx: CmdCtx = {
			group,
			args,
			user,
			cmd,
			startTyping: startTyping.bind(msg.chat),
			send,
			react,
			msg,
			t,
		}

		/* * Cooldown checking */
		const now = Date.now()
		if (user.delay > now) {
			user.delay = Math.min(user.delay + cmd.cooldown, now + cmd.cooldown * 10)
			// cap at 10 queued commands to prevent runaway delay accumulation
			const timeout = user.delay - now

			if (timeout < 10_000) {
				await send(t('events.cooldown', { time: timeout.duration(true) }))
				// warns user about cooldown
			}

			await delay(timeout)
			// wait until it gets finished
		} else user.delay = now + cmd.cooldown

		user.addCmd() // 1+ on user personal cmds counter

		try {
			await cmd.run!(ctx)
		} catch (e: any) {
			print(`CMD/${cmd.name}`, e, 'red')
			send(`[⚠️] ${e?.message || e}`)
		}
	}
}
