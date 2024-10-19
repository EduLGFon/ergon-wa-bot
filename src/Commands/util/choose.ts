import type { CmdContext } from '../../Typings';
import Command from '../../Core/Command';

export default class extends Command {
	constructor() {
		super({});
	}
	async run({ bot, msg, args }: CmdContext) {
		const options = args.join(' ').split(',');
		const randomOption = options[Math.floor(Math.random() * options.length)];

		return await bot.send(msg, '```' + randomOption + '```');
	}
}
