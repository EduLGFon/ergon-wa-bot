import type { CmdContext, Lang } from '../../Core/Typings/types.d.ts';
import { langs, runCode } from '../../Core/Plugins/RunCode.js';
import { cleanTemp } from '../../Core/Components/Utils.js';
import Command from '../../Core/Classes/Command.js';
import { Duration } from 'luxon';

export default class extends Command {
	constructor() {
		super({
			aliases: ['e'],
			access: { onlyDevs: true },
		});
	}

	async run(ctx: CmdContext) {
		// Language to be runned
		const lang = (langs.includes(ctx.args[0] as 'py') ? ctx.args.shift() : 'eval') as Lang;
		const startTime = Date.now();

		const output = await runCode({ lang, code: ctx.args.join(' '), ctx });

		const dur = Duration
			.fromMillis(Date.now() - startTime || 1)
			.rescale()
			.toHuman({ unitDisplay: 'narrow' });
		const RAMusage = process.memoryUsage().rss.bytes();

		const text = `*[👨‍💻] - ${lang.toUpperCase()}* [${dur} - ${RAMusage}]\n` +
			output.trim();

		cleanTemp();

		ctx.bot.send(ctx.msg, text);
		return;
	}
}
