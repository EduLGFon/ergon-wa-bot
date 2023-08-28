import type { CmdContext } from '../../Typings';
import Command from '../../Core/Command';
import { inspect } from 'util';

export default class extends Command {
	constructor() {
		super({
			aliases: ['e'],
			access: {
				onlyDevs: true,
			},
		});
	}

	async run(ctx: CmdContext) {
		const startTime = Date.now();
		const initialRam = (process.memoryUsage().rss / 1024 / 1024).toFixed(2); // DENO

		const code = ctx.args.join(' ');
		let evaled, title;

		try {
			// Roda o eval em uma função assíncrona se ele conter a palavra "await"
			evaled = code.includes('await')
				? await eval(`(async () => { ${code} })()`)
				: await eval(code);

			title = '🎉 Retorno'; // Título da msg
			evaled = inspect(evaled, { depth: null }); // Retorno do eval
		} catch (error) {
			title = '❌ Falha'; // Título da msg
			evaled = error; // Retorno do eval
		} finally {
			// Consumo de RAM ao final do eval
			const currentRam = (process.memoryUsage().rss / 1024 / 1024).toFixed(2);

			const text = `⏰ *Duração:* ${Date.now() - startTime}ms\n` +
				`🎞️ *RAM:* ${initialRam}/${currentRam}MB\n` +
				`*${title}:*\n\n ` + '```\n' + evaled + '```';

			return await ctx.bot.send(ctx.msg, text);
		}
	}
}
