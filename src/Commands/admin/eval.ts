import type { CmdContext } from '../../Typings';
import Command from '../../Core/Command';
import { inspect } from 'util';

export default class extends Command {
	constructor() {
		super({
			aliases: ['e'],
			// react: false,
			access: { onlyDevs: true },
		});
	}

	async run(ctx: CmdContext) {
		const startTime = Date.now();
		const startRAM = this.getRAM(); // DENO

		const code = ctx.args.join(' ');
		let output, reaction = '✅'; // Reaction emoji

		try {
			// Run eval in async function if it contains 'await'
			output = code.includes('await')
				? await eval(`(async () => { ${code} })()`)
				: await eval(code);

			output = inspect(output, { depth: null }); // eval result
		} catch (e: any) {
			reaction = '❌'; // Reaction emoji
			output = String(e?.stack || e);
		} finally {
			// difference between initial RAM and final RAM
			const endRAM = this.getRAM();
			const RAMRange = Number((endRAM - startRAM).toFixed(2));
			const duration = (Date.now() - startTime).toLocaleString('pt'); // db

			const text = `*[👨‍💻] - Eval*\n` +
				`*[⏰]: ${duration}ms*\n` +
				`*[🎞️]: ${endRAM}MB (${RAMRange < 0 ? RAMRange : `+${RAMRange}`}MB)*\n` +
				'```\n' + output.trim() + '```';

			const msg = await ctx.bot.send(ctx.msg, text);
			return await ctx.bot.react(msg, reaction);
		}
	}

	getRAM = () => {
		const RAMUsage = process.memoryUsage().rss / 1024 / 1024;
		return Number(RAMUsage.toFixed(2));
	};
}
