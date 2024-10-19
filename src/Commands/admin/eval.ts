import type { CmdContext, Lang } from '../../Core/Typings/index';
import { langs, run } from '../../Core/Plugins/RunOtherLangs';
import { getRAM } from '../../Core/Components/Prototypes';
import { clearTemp } from '../../Core/Components/Utils';
import Command from '../../Core/Classes/Command';

export default class extends Command {
	constructor() {
		super({
			aliases: ['e'],
			// react: false,
			access: { onlyDevs: true },
		});
	}

	async run(ctx: CmdContext) {
		const { args, bot, msg, prisma, user, group, cmd, callCmd, t, sendUsage } = ctx;

		const lang = (langs.includes(args[0] as 'py') ? args.shift() : 'eval') as Lang;

		let output, reaction = '✅'; // Reaction emoji

		const startTime = Date.now();
		const startRAM = getRAM(true) as number

		try {
			output = await run.bind(this)(lang, args.join(' '));
		} catch (e: any) {
			reaction = '❌'; // Reaction emoji
			output = String(e?.stack || e);
		} finally {
			// difference between initial RAM and final RAM
			const duration = (Date.now() - startTime).toLocaleString('pt');
			const endRAM = getRAM(true) as number;
			const RAMRange = endRAM - startRAM;

			const text = `*[👨‍💻] - ${lang.toUpperCase()}*\n` +
				`[📊]: ${duration}ms - ` +
				`${endRAM}MB (${RAMRange < 0 ? RAMRange : `+${RAMRange}`}MB)\n` +
				output;

			clearTemp();

			const reply = await bot.send(msg, text);
			bot.react(reply.msg, reaction);
			return;
		}
	}
}
