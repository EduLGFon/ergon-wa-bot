import { CmdContext } from '../../Typings';
import { getCtx } from '../../Core/Utils';
import { DEVS } from '../../config.json';
import type bot from '../../Core/Bot';
import { type proto } from 'baileys';
import { appendFile } from 'fs';
import { inspect } from 'util';

export default async function (this: bot, raw: { messages: proto.IWebMessageInfo[] }, e: string) {
	if (!raw.messages[0].message) return;

	// get msg obj
	const { msg, group, user, prisma } = await getCtx(raw.messages[0], this);

	// message log
	appendFile('log/messages.log', inspect(msg, { depth: null }), () => {});

	// run 'waitFor' events
	if (this.wait.has(e)) this.wait.get(e)!.bind(this)(msg);

	if (!msg.text.startsWith(user.prefix)) return;

	const args: string[] = msg.text.replace(user.prefix, '').trim().split(' ');
	const callCmd = args.shift()!.toLowerCase()!;
	// search command by name or by aliases
	const cmd = this.cmds.get(callCmd) || this.cmds.get(this.aliases.get(callCmd)!);

	if (!cmd) return;
	// block only devs cmds for normal people
	if (cmd.access?.onlyDevs && !DEVS.includes(user.id)) return this.react(msg, '🚫');

	const ctx: CmdContext = {
		prisma,
		args,
		bot: this,
		callCmd,
		cmd,
		group,
		msg,
		user,
	};

	// react if the cmd takes more than 2 seconds to run
	const t = setTimeout(() => this.react(msg, '⏳'), 2_000);
	try {
		await cmd.run!(ctx);

		this.react(msg, '✅');
	} catch (e: any) {
		this.send(msg, `[⚠️] ${e?.stack || e}`);
		this.react(msg, '❌');
	} finally {
		clearTimeout(t);
	}
}
