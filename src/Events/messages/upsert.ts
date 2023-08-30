import { convertMsgData } from '../../Core/Utils';
import { devs, prefix } from '../../config.json';
import type bot from '../../Core/Bot';
import { type proto } from 'baileys';
import { appendFile } from 'fs';
import { inspect } from 'util';

export default async function (this: bot, raw: { messages: proto.IWebMessageInfo[] }, e: string) {
	if (!raw.messages[0].message) return;

	// get msg obj
	const msg = await convertMsgData(raw.messages[0], this);

	// message log
	appendFile(
		'log/messages.log',
		`\n${msg.username}: ${msg.text} (${msg.type})\n${inspect(msg, { depth: null })}`,
		() => {},
	);

	// run 'waitFor' events
	if (this.wait.has(e)) this.wait.get(e)!.bind(this)(msg);

	if (!msg.text.startsWith(prefix)) return;

	const args: string[] = msg.text.replace(prefix, '').trim().split(' ');
	const callCmd = args.shift()!.toLowerCase()!;
	// search command by name or by aliases
	const cmd = this.cmds.get(callCmd) || this.cmds.get(this.aliases.get(callCmd)!);

	if (!cmd) return;
	// block only devs cmds for normal people
	if (cmd.access?.onlyDevs && !devs.includes(msg.author)) return this.react(msg, '🚫');

	// react if the cmd takes more than 2 seconds to run
	const t = setTimeout(() => this.react(msg, '⏳'), 2_000);
	try {
		await cmd.run!({ msg, args, cmd, callCmd, bot: this });
		this.react(msg, '✅');
	} catch (e: any) {
		this.send(msg, `[⚠️] Error: ${e}`);
		this.react(msg, '❌');
	} finally {
		clearTimeout(t);
	}
}
