import BotClient from '../../Client';

export default class implements Command {
	public aliases = ['p'];
	public access = {
		dm: true,
		groups: true,
	};

	run = async (bot: BotClient, msg: Msg) => {
		const time = Date.now();
		await bot.send(msg.chat, '...');

		return await bot.send(msg.chat, `Ping: *${Date.now() - time}ms*`, msg.raw);
	};
}
