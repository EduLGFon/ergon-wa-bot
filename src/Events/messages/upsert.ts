import { CmdContext } from '../../Components/Typings/index';
import { getCtx } from '../../Components/Core/Utils';
import bot from '../../Components/Classes/Bot';
import { DEVS } from '../../JSON/config.json';
import { type proto } from 'baileys';
import i18next from 'i18next';

export default async function (this: bot, raw: { messages: proto.IWebMessageInfo[] }, e: string) {
	if (!raw.messages[0].message) return;

	// get msg obj
	const { msg, group, user, prisma } = await getCtx(raw.messages[0], this);

	// run 'waitFor' events
	if (this.wait.has(e)) this.wait.get(e)!.bind(this)(msg);

	if (!msg.text.startsWith(user.prefix)) return;

	const args: string[] = msg.text.replace(user.prefix, '').trim().split(' ');
	const callCmd = args.shift()!.toLowerCase()!;
	// search command by name or by aliases
	const cmd = this.cmds.get(callCmd) || this.cmds.get(this.aliases.get(callCmd)!);
	// get locales function
	const t = i18next.getFixedT(user.lang);

	if (!cmd) return;
	// block only devs cmds for normal people
	if (cmd.access?.onlyDevs && !DEVS.includes(user.id)) return this.react(msg, '🚫');

	// react if the cmd takes more than 2 seconds to run
	const timeout = setTimeout(() => this.react(msg, '⏳'), 1_000);

	const sendUsage = async () => {
		clearTimeout(timeout);

		const usage = `*[❗] - ${t('usage:usage.title')}*\n\n` +
			`➠ ${user.prefix}${cmd.name} ${t(`usage:${cmd.name}`)}` +
			`\n\n[📖] ${t(`usage:usage.args`)}`;

		this.react(msg, '🤔');
		await this.send(msg, usage);

		return;
	};

	const ctx: CmdContext = {
		prisma,
		args,
		bot: this,
		callCmd,
		cmd,
		group,
		msg,
		t,
		user,
		sendUsage,
	};
	try {
		// run cmd and then react the msg
		await cmd.run!(ctx) && this.react(msg, '✅');
	} catch (e: any) {
		this.send(msg, `[⚠️] ${e?.stack || e}`);
		this.react(msg, '❌');
	} finally {
		clearTimeout(timeout);
	}
}
