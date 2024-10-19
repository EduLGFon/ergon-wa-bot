import BotClient from '../../Client';

export default class implements Command {
	public access = { dm: true, groups: true };

	public run(msg: Msg, bot: BotClient) {
		const ping = Date.now() - msg.timestamp;

		bot.send(msg.chat, `Ping: *${ping}ms*`);
	}
}
