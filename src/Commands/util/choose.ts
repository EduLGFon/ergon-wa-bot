import BotClient from '../../Client';

export default class implements Command {
	public access = {
		dm: true,
		groups: true,
	};

	run = async (bot: BotClient, msg: Msg, args: string[]) => {
		const options = args.join(' ').split(',');
		const randomOption = options[Math.floor(Math.random() * options.length)];

		return await bot.send(msg.chat, '```' + randomOption + '```');
	};
}
