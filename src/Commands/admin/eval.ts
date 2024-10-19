import { langs, runOtherLang } from '../../Core/Plugins/RunOtherLangs.js';
import type { CmdContext, Lang } from '../../Core/Typings/types.ts';
import { getRAM } from '../../Core/Components/Prototypes.js';
import { clearTemp } from '../../Core/Components/Utils.js';
import Command from '../../Core/Classes/Command.js';

export default class extends Command {
	constructor() {
		super({
			aliases: ['e'],
			access: { onlyDevs: true },
		});
	}

	async run(ctx: CmdContext) {
		const lang = (langs.includes(ctx.args[0] as 'py') ? ctx.args.shift() : 'eval') as Lang;
		const startTime = Date.now();

		let output = await runOtherLang({ lang, code: ctx.args.join(' '), ctx });

		const duration = (Date.now() - startTime).toLocaleString('pt');

		const text = `*[👨‍💻] - ${lang.toUpperCase()}* ` +
			`${duration}ms - ${getRAM()}` + '\n\n' +
			output.trim()
				.slice(0, 256);

		clearTemp();

		ctx.bot.send(ctx.msg, text);
		return;
	}
}
