import type { CmdContext } from '../../Components/Typings/index';
import Command from '../../Components/Classes/Command';
import { execSync } from 'child_process';

export default class extends Command {
	constructor() {
		super({
			aliases: ['exec', 'run', 'execute'],
			access: { onlyDevs: true },
		});
	}

	async run({ args, bot, msg }: CmdContext) {
		const startTime = Date.now();
		const startRAM = this.getRAM(); // DENO

		let reaction = '✅', // Reaction emoji
			output = '';

		try {
			output = execSync(args.join(' ')).toString();
		} catch (e: any) {
			reaction = '❌'; // Reaction emoji
			output = String(e?.stack || e); // process error
		} finally {
			// difference between initial RAM and final RAM
			const endRAM = this.getRAM();
			const RAMRange = Number((endRAM - startRAM).toFixed(2));
			const duration = (Date.now() - startTime).toLocaleString('pt'); // db

			const text = `*[👨‍💻] - Child Process*\n` +
				`*[⏰]: ${duration}ms*\n` +
				`*[🎞️]: ${endRAM}MB (${RAMRange < 0 ? RAMRange : `+${RAMRange}`}MB)*\n` +
				output.trim().encode();

			const sentMsg = await bot.send(msg, text);
			await bot.react(sentMsg.msg, reaction);
			return true;
		}
	}

	getRAM = () => {
		const RAMUsage = process.memoryUsage().rss / 1024 / 1024;
		return Number(RAMUsage.toFixed(2));
	};
}
