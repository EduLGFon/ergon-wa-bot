import config from '../../Core/JSON/config.json' assert { type: 'json' };
import type { CmdContext } from '../../Core/Typings/types.js';
import { coolMsgTypes } from '../../Core/Typings/MsgTypes.js';
import { getCtx } from '../../Core/Components/Utils.js';
import type Bot from '../../Core/Classes/Bot.js';
import Cmd from '../../Core/Classes/Command.js';
import { type proto } from 'baileys';
import { Duration } from 'luxon';
import i18next from 'i18next';

export default async function (bot: Bot, raw: { messages: proto.IWebMessageInfo[] }, e: str) {
	if (!raw.messages[0]) return;

	for (const message of raw.messages) {
		// get abstract msg obj
		const { msg, group, user } = await getCtx(message, bot);

		if (group && Object.values(coolMsgTypes).includes(msg.type)) {
			group.cacheMsg(msg);
			if (!msg.isBot) group.countMsg(user.id);
		}

		// run 'waitFor' events
		if (bot.wait.has(e)) bot.wait.get(e)(bot, msg, user, group);

		if (!msg.text.startsWith(user.prefix)) continue;

		const args: str[] = msg.text.replace(user.prefix, '').trim().split(' ');
		const callCmd = args.shift()!.toLowerCase()!;
		// search command by name or by aliases
		const cmd: Cmd = bot.cmds.get(callCmd) || bot.cmds.get(bot.aliases.get(callCmd)!);

		if (!cmd) continue;
		// block only devs cmds for normal people
		if (cmd.access.onlyDevs && !config.DEVS.includes(user.id)) {
			bot.react(msg, '⛔');
			continue;
		}

		const ctx: CmdContext = {
			// get locales function
			t: i18next.getFixedT(user.lang),
			sendUsage,
			callCmd,
			group,
			args,
			user,
			bot,
			cmd,
			msg,
		};

		const cooldown = user.lastCmd.time + cmd.cooldown * 1_000 - Date.now();
		if (cooldown > 699) {
			const time = Duration
				.fromMillis(cooldown)
				.rescale()
				.shiftTo('seconds')
				.toHuman({ unitDisplay: 'long' });

			bot.send(
				msg,
				`[📛] - Hold on! You need to wait *${time}* before executing another command.`,
			);
			continue;
		}

		user.addCmd();

		try {
			// start typing (expires after about 10 seconds.)
			bot.sock.sendPresenceUpdate('composing', msg.chat);

			cmd.run!(ctx);
		} catch (e: any) {
			bot.send(msg, `[⚠️] ${e?.stack || e}`);

			bot.react(msg, '❌');
		}

		async function sendUsage() {
			args[0] = cmd.name;

			bot.cmds.get('help').run(ctx);
			bot.react(msg, '🤔');
			return;
		}
	}
	return;
}
