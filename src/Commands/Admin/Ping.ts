import BotClient from '../../Client';

export default class implements Command {
	public access = {
		dm: true,
		groups: true,
	};
	public run = (bot: BotClient, msg: Msg) => {
		const ping = Date.now() - msg.timestamp;

		bot.send(msg.chat, `Ping: *${ping}ms*`, msg.raw);
	};
}
