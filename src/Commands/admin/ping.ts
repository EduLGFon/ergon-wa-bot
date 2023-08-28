import Command from '../../Core/Command';
import { CmdContext } from '../../Typings';

export default class extends Command {
	async run(ctx: CmdContext) {
		const time = Date.now();
		await this.bot.send(ctx.msg.chat, 'Calculando...');

		return await this.bot.send(ctx.msg, `Ping: *${Date.now() - time}ms*`);
	}
}
