import { CmdContext } from '../../Typings';
import Command from '../../Core/Command';
import translate from 'google-translate';

export default class extends Command {
	constructor() {
		super({
			aliases: ['t'],
			cooldown: 5,
		});
	}

	async run({ bot, msg, args }: CmdContext) {
		if (!args[1]) return bot.react(msg, '❌');

		const options = {
			to: args.shift(),
		};
		const t = await translate(args.join(' '), options);

		const text = '*[🌐] Google Translate*\n' +
			`*${t.from.language.iso}  ➟  ${options.to}*\n` +
			'```\n' + t.text + '```';

		return await bot.send(msg, text);
	}
}
