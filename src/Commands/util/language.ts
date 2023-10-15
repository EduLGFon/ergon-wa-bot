import type { CmdContext } from '../../Core/Typings/index.d.ts';
import { languages } from '../../Core/Components/Locales.js';
import Command from '../../Core/Classes/Command.js';

export default class extends Command {
	constructor() {
		super({
			aliases: ['lang', 'idioma'],
		});
	}

	async run({ t, bot, args, msg, user, sendUsage }: CmdContext) {
		if (!languages.includes(args[0])) return sendUsage();

		user.lang = args[0].slice(0, 2);

		bot.send(msg, t('language.changed', { lng: user.lang }));
		return;
	}
}
