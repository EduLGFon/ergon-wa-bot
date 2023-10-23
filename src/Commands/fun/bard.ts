import { runOtherLang } from '../../Core/Plugins/RunOtherLangs.js';
import { CmdContext } from '../../Core/Typings/types.js';
import Command from '../../Core/Classes/Command.js';

export default class extends Command {
	constructor() {
		super({
			aliases: ['b'],
		});
	}

	async run({ args, bot, msg, sendUsage }: CmdContext) {
		if (!args[0]) return sendUsage();

		let res = await runOtherLang({
			file: 'src/Core/Plugins/Bard.py',
			code: `"${process.env.BARD_TOKEN1}" "${process.env.BARD_TOKEN2}" ` +
				`"${process.env.BARD_TOKEN3}" "${args.join(' ')}"`,
		});

		res = res
			.replace(process.env.BARD_TOKEN1!, 'BARD_TOKEN')
			.replace(process.env.BARD_TOKEN2!, 'BARD_TOKEN')
			.replace(process.env.BARD_TOKEN3!, 'BARD_TOKEN');

		bot.send(msg, res);
		return;
	}
}
