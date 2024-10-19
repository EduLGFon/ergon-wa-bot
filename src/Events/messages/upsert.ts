import { convertMsgData } from '../../Core/Utils';
import { devs, prefix } from '../../config.json';
import BotClient from '../../Client';
import { proto } from 'baileys';

export default async function (bot: BotClient, rawMsg: { messages: proto.IWebMessageInfo[] }) {
	if (!rawMsg.messages[0].message) return;

	const msg = await convertMsgData(rawMsg.messages[0], bot);

	if (!msg.text.startsWith(prefix)) return;

	const args: string[] = msg.text.replace(prefix, '').trim().split(' ');
	const callCmd = args.shift()!.toLowerCase()!;
	// procura o cmd pelo nome no Map de cmds e no Map de aliases
	const cmd = bot.cmds.get(callCmd) || bot.cmds.get(bot.aliases.get(callCmd)!);

	if (!cmd) return;
	if (cmd.access?.onlyDevs && !devs.includes(msg.author)) return;

	try {
		bot.react(msg, '⏳');
		await cmd.run!(bot, msg, args);
		bot.react(msg, '✅');
	} catch (e: any) {
		console.log(`Error on ${cmd.name}: ${e.stack}`);
		bot.react(msg, '❌');
	}
}
