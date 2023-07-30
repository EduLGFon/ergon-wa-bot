import { convertMsgData } from '../../Core/Utils';
import { devs, prefix } from '../../config.json';
import type bot from '../../Core/Bot';
import { type proto } from 'baileys';

export default async function (this: bot, raw: { messages: proto.IWebMessageInfo[] }, e: string) {
	if (!raw.messages[0].message) return;

	const msg = await convertMsgData(raw.messages[0], this);

	if (this.wait.has(e)) this.wait.get(e)!.bind(this, msg);

	if (!msg.text.startsWith(prefix)) return;

	const args: string[] = msg.text.replace(prefix, '').trim().split(' ');
	const callCmd = args.shift()!.toLowerCase()!;
	// procura o cmd pelo nome no Map de cmds e no Map de aliases
	const cmd = this.cmds.get(callCmd) || this.cmds.get(this.aliases.get(callCmd)!);

	if (!cmd) return this.react(msg, '🤔');
	if (cmd.access?.onlyDevs && !devs.includes(msg.author)) {
		return this.react(msg, '🚫');
	}

	const t = setTimeout(() => this.react(msg, '⏳'), 1_500);
	try {
		await cmd.run!.bind(this)(msg, args);
		this.react(msg, '✅');
	} catch (e: any) {
		console.log(`Error on ${cmd.name}: ${e.stack}`);
		this.react(msg, '❌');
	} finally {
		clearTimeout(t);
	}
}
