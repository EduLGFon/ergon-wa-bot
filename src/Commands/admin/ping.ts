import type bot from '../../Core/Bot';

export default class implements Command {
	public aliases = ['p'];
	public access = {
		dm: true,
		groups: true,
	};

	run = async function (this: bot, msg: Msg) {
		const time = Date.now();
		await this.send(msg.chat, '...');

		return await this.send(msg, `Ping: *${Date.now() - time}ms*`);
	};
}
