import { CmdContext } from '../../Components/Typings/index';
import Command from '../../Components/Classes/Command';
import translate from 'google-translate';

export default class extends Command {
	constructor() {
		super({
			aliases: ['t'],
			cooldown: 5,
		});
	}

	async run({ bot, msg, args, sendUsage }: CmdContext) {
		if (!args[1]) return sendUsage();

		const toLang = args.shift();
		try {
			const t = await translate(args.join(' '), { to: toLang });

			const text = '*[🌐] - Google Translate*\n' +
				`*${t?.from.language.iso}  ➟  ${toLang}*\n` +
				'```' + t?.text + '```';
			await bot.send(msg, text);
			return true;
		} catch (_e) {
			return sendUsage();
		}
	}
}
