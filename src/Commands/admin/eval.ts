import type { CmdContext, Lang } from '../../Core/Typings/types.d.ts';
import { langs, runCode } from '../../Core/Plugins/RunCode.js';
import { cleanTemp } from '../../Core/Components/Utils.js';
import { delay } from '../../Core/Components/Utils.js';
import prisma from '../../Core/Components/Prisma.js';
import Cmd from '../../Core/Classes/Command.js';
import { inspect } from 'node:util';
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
		const lang = (langs.includes(args[0] as 'cpp') ? args.shift() : null) as Lang | null;
		const code = args.join(' ');
		let output, startTime: num;
		bot.react(msg, '⌛');

		if (!lang) {
			const { user, group, cmd, callCmd, t, sendUsage } = ctx;
			prisma;
			delay; // i may need it, so TS won't remove from build if it's here

			let evaled = code.includes('await')
				? await eval(`(async () => { ${code} })()`)
				: await eval(code!);

			output = inspect(evaled, { depth: null });
		} else {
			startTime = Date.now();
			output = await runCode({ lang, code });
		}

		const dur = Duration
			.fromMillis(Date.now() - startTime! || 1)
			.rescale()
			.toHuman({ unitDisplay: 'narrow' });
		const RAMusage = process.memoryUsage().rss.bytes();

		const text = `*[👨‍💻] - ${(lang || 'EVAL').toUpperCase()}* [${dur} - ${RAMusage}]\n` +
			output.trim();

		cleanTemp();

		bot.send(msg, text);
		bot.react(msg, '✅');
		return;
	}
}
