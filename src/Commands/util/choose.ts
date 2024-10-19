import type { CmdContext } from '../../Components/Typings/index';
import Command from '../../Components/Classes/Command';

export default class extends Command {
	constructor() {
		super({});
	}
	async run({ t, bot, msg, args, sendUsage }: CmdContext) {
		if (!args[0] || !msg.text.includes(',')) return sendUsage();

		const options = args.join(' ').split(',');
		if (!options[1]) return sendUsage();

		const choosedOne = options[Math.floor(Math.random() * options.length)];

		await bot.send(msg, t('choose', { choosedOne }));
		return true;
	}
}
