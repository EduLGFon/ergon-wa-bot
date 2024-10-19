import { Baileys, checkPermissions, CmdCtx, coolValues, getCtx } from '../../map.js'
import { type proto } from 'baileys'
import { getFixedT } from 'i18next'
import { Duration } from 'luxon'

export default async function (bot: Baileys, raw: { messages: proto.IWebMessageInfo[] }, e: str) {
	// raw.messages = []
	if (!raw.messages[0]) return

	for (const m of raw.messages) {
		if (!m.message) continue

		// get abstract msg obj
		const { msg, args, cmd, group, user } = await getCtx(m, bot)

		if (group && coolValues.includes(msg.type)) {
			group.cacheMsg(msg)
			if (!msg.isBot) group.countMsg(user.id)
		}

		// run 'waitFor' events
		if (bot.wait.has(e)) bot.wait.get(e)(bot, msg, user, group)
			
		if (!cmd) continue
		// Check cmd permissions
		const auth = checkPermissions(cmd, user, group)
		if (auth !== true) {
			bot.react(msg, auth)
			continue
		}

		const ctx: CmdCtx = {
			// get locales function
			t: getFixedT(user.lang),
			sendUsage,
			group,
			args,
			user,
			bot,
			cmd,
			msg,
		}

		const cooldown = user.lastCmd.time + cmd.cooldown * 1_000 - Date.now()
		if (cooldown > 699) {
			const time = Duration
				.fromMillis(cooldown)
				.rescale()
				.shiftTo('seconds')
				.toHuman({ unitDisplay: 'long' })

			bot.send(
				msg,
				`[📛] - Hold on! You need to wait *${time}* before executing another command.`,
			)
			continue
		}

		user.addCmd()

		try {
			// start typing (expires after about 10 seconds.)
			// bot.sock.sendPresenceUpdate('composing', msg.chat);

			Promise.resolve(cmd.run!(ctx))
		} catch (e: any) {
			bot.send(msg, `[⚠️] ${e?.stack || e}`)

			bot.react(msg, 'x')
		}

		async function sendUsage() {
			args[0] = cmd.name

			bot.cmds.get('help').run(ctx)
			bot.react(msg, '🤔')
			return
		}
	}
	return
}
