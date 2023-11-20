import type { CmdContext } from '../../Core/Typings/types.js';
import Cmd from '../../Core/Classes/Command.js';
import { execSync } from 'node:child_process';
import { Duration } from 'luxon';

export default class extends Cmd {
	constructor() {
		super({
			aliases: ['exec', 'run', 'execute'],
			access: { onlyDevs: true },
		});
	}

	async run({ args, bot, msg }: CmdContext) {
		const startTime = Date.now();

		let output = '';

		try {
			output = execSync(args.join(' ')).toString();
		} catch (e: any) {
			output = String(e?.stack || e); // process error
		} finally {
			const dur = Duration
				.fromMillis(Date.now() - startTime)
				.rescale()
				.toHuman({ unitDisplay: 'narrow' });

			const RAM = process.memoryUsage().rss.bytes();

			const text = `*[👨‍💻] - Child Process* ${dur} - ${RAM}\n` +
				output.trim();

			bot.send(msg, text);
			return;
		}
	}
}
