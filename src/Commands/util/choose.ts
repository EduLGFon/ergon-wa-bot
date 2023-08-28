import type { CmdContext } from '../../Typings';
import Command from '../../Core/Command';

export default class extends Command {
	constructor() {
		super({});
	}
	async run(ctx: CmdContext) {
		const options = ctx.args.join(' ').split(',');
		const randomOption = options[Math.floor(Math.random() * options.length)];

		return await ctx.bot.send(ctx.msg, '```' + randomOption + '```');
	}
}
