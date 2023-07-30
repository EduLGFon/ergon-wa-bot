import type bot from '../../Core/Bot';

export default class implements Command {
	public access = {
		dm: true,
		groups: true,
	};

	run = async function (this: bot, msg: Msg, args: string[]) {
		const options = args.join(' ').split(',');
		const randomOption = options[Math.floor(Math.random() * options.length)];

		return await this.send(msg, '```' + randomOption + '```');
	};
}
