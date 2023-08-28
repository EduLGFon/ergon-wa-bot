import type { CmdContext } from '../../Typings';
import { execSync } from 'child_process';
import Command from '../../Core/Command';

export default class extends Command {
	constructor() {
		super({
			aliases: ['exec', 'run', 'execute'],
			access: { onlyDevs: true },
		});
	}

	async run(ctx: CmdContext) {
		const startTime = Date.now();
		const initialRam = (process.memoryUsage().rss / 1024 / 1024).toFixed(2); // DENO

		let title;
		let output;

		try {
			output = execSync(ctx.args.join(' ') || '').toString();

			title = '🎉 Retorno'; // Título da msg
		} catch (error) {
			title = '❌ Falha'; // Título da msg
			output = String(error); // Retorno do eval
		} finally {
			output = output!.trim();

			// Consumo de RAM ao final do processo
			const currentRam = (process.memoryUsage().rss / 1024 / 1024).toFixed(2);

			const text = `⏰ *Duração:* ${Date.now() - startTime}ms\n` +
				`🎞️ *RAM:* ${initialRam}/${currentRam}MB\n` +
				`*${title}:*\n\n ` + '```\n' + (output || '- Sem retorno.') + '```';

			return await ctx.bot.send(ctx.msg, text);
		}
	}
}
