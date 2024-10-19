import type { CmdContext } from '../../Core/Typings/types.js';
import Cmd from '../../Core/Classes/Command.js';

export default class extends Cmd {
	constructor() {
		super({});
	}
	async run({ t, bot, msg, args, sendUsage }: CmdContext) {
		if (!args[0] || !msg.text.includes(',')) return sendUsage();

		const options = args.join(' ').split(',');
		if (!options[1]) return sendUsage();

		const chosen = options[Math.floor(Math.random() * options.length)];

		bot.send(msg, t('choose.result', { chosen: chosen.encode() }));
		return;
	}
}
