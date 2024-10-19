import { langs, runOtherLang } from '../../Core/Plugins/RunOtherLangs.js';
import type { CmdContext, Lang } from '../../Core/Typings/types.ts';
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

		let output = '';

		const startTime = Date.now();
		const startRAM = getRAM(true) as number;

		output = await runOtherLang({ lang, code: ctx.args.join(' '), ctx });

		// difference between initial RAM and final RAM
		const duration = (Date.now() - startTime).toLocaleString('pt');
		const endRAM = getRAM(true) as number;

		let RAMRange: str | num = Number((endRAM - startRAM).toFixed(2));
		RAMRange = RAMRange < 0 ? RAMRange : `+${RAMRange}`;

		const text = `*[👨‍💻] - ${lang.toUpperCase()}*\n` +
			`[📊]: ${duration}ms - ` + `${endRAM}MB (${RAMRange}MB)\n` +
			output.trim()
				.slice(0, 256);

		clearTemp();

		const reply = await ctx.bot.send(ctx.msg, text);
		return;
	}
}
