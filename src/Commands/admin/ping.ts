import Command from '../../Core/Command';
import { CmdContext } from '../../Typings';

export default class extends Command {
	constructor() {
		super({
			aliases: ['p'],
		});
	}
	async run(ctx: CmdContext) {
		const time = Date.now();
		await ctx.bot.send(ctx.msg.chat, 'Calculando...');

		return await ctx.bot.send(ctx.msg, `Ping: *${Date.now() - time}ms*`);
	}
}
