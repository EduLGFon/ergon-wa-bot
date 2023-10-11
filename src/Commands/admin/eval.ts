import type { CmdContext, Lang } from '../../Components/Typings/index';
import { langs, run } from '../../Components/Plugins/RunOtherLangs';
import { clearTemp } from '../../Components/Core/Utils';
import Command from '../../Components/Classes/Command';

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
		const startRAM = this.getRAM(); // DENO

		try {
			output = await run.bind(this)(lang, args.join(' '));
		} catch (e: any) {
			reaction = '❌'; // Reaction emoji
			output = String(e?.stack || e);
		} finally {
			// difference between initial RAM and final RAM
			const duration = (Date.now() - startTime).toLocaleString('pt');
			const endRAM = this.getRAM();
			const RAMRange = Number((endRAM - startRAM).toFixed(2));

			const text = `*[👨‍💻] - ${lang.toUpperCase()}*\n` +
				`[📊]: ${duration}ms - ` +
				`${endRAM}MB (${RAMRange < 0 ? RAMRange : `+${RAMRange}`}MB)\n` +
				output;

			clearTemp();

			const sentMsg = await bot.send(msg, text);
			await bot.react(sentMsg.msg, reaction);
			return true;
		}
	}

	getRAM = () => {
		const RAMUsage = process.memoryUsage().rss / 1024 / 1024;
		return Number(RAMUsage.toFixed(2));
	};
}
