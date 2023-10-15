import Command from '../../Core/Classes/Command';
import { CmdContext } from '../../Core/Typings';

export default class extends Command {
	constructor() {
		super({
			aliases: ['prefixo'],
		});
	}

	async run({ t, user, msg, bot, args, sendUsage }: CmdContext) {
		if (!args[0] || args[0].length > 3) return sendUsage();

		user.prefix = args[0].slice(0, 3);

		bot.send(msg, t('prefix.changed', { prefix: user.prefix }));
		return;
	}
}
