import { langs, runOtherLang } from '../../Core/Plugins/RunOtherLangs.js';
import type { CmdContext, Lang } from '../../Core/Typings/index.d.ts';
import { getRAM } from '../../Core/Components/Prototypes.js';
import { clearTemp } from '../../Core/Components/Utils.js';
import Command from '../../Core/Classes/Command.js';

export default class extends Command {
	constructor() {
		super({
			aliases: ['e'],
			// react: false,
			access: { onlyDevs: true },
		});
	}

	async run(ctx: CmdContext) {
		const lang = (langs.includes(ctx.args[0] as 'py') ? ctx.args.shift() : 'eval') as Lang;

		let output, reaction = '✅'; // Reaction emoji

		const startTime = Date.now();
		const startRAM = getRAM(true) as number;

		try {
			output = await runOtherLang({ lang, code: ctx.args.join(' '), ctx });
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
				output!.trim().encode();

			clearTemp();

			const reply = await ctx.bot.send(ctx.msg, text);
			ctx.bot.react(reply.msg, reaction);
			return;
		}
	}
}
