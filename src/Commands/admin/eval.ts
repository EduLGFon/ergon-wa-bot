import type { CmdContext, Lang } from '../../Core/Typings/types.d.ts';
import { langs, runCode } from '../../Core/Plugins/RunCode.js';
import { cleanTemp } from '../../Core/Components/Utils.js';
import Cmd from '../../Core/Classes/Command.js';
import { Duration } from 'luxon';

export default class extends Cmd {
	constructor() {
		super({
			aliases: ['e'],
			access: { onlyDevs: true },
			cooldown: 0,
		});
	}

	async run(ctx: CmdContext) {
		const { args, bot, msg } = ctx;

		// Language to be runned
		const lang = (langs.includes(args[0] as 'py') ? args.shift() : 'eval') as Lang;
		bot.react(msg, '⌛');

		const startTime = Date.now();
		const output = await runCode({ lang, code: args.join(' '), ctx });

		const dur = Duration
			.fromMillis(Date.now() - startTime || 1)
			.rescale()
			.toHuman({ unitDisplay: 'narrow' });
		const RAMusage = process.memoryUsage().rss.bytes();

		const text = `*[👨‍💻] - ${lang.toUpperCase()}* [${dur} - ${RAMusage}]\n` +
			output.trim();

		cleanTemp();

		bot.send(msg, text);
		bot.react(msg, '✅');
		return;
	}
}
