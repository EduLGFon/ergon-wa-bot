import { CmdContext, GroupMsg } from '../../Core/Typings/types.js';
import prisma from '../../Core/Components/Prisma.js';
import Cmd from '../../Core/Classes/Command.js';
import User from '../../Core/Classes/User.js';

export default class extends Cmd {
	constructor() {
		super({
			aliases: ['r'],
			access: {
				dm: false,
				groups: true,
			},
		});
	}

	async run({ bot, msg, group, t }: CmdContext) {
		let text = `*[🏆] - ${group!.name}'s Rank*\n\n`;

		let msgs = await group!.getCountedMsgs() as GroupMsg[];

		// same as SQL "ORDERBY count DESC"
		msgs = msgs.sort((a, b) => b.count - a.count);

		for (const i in msgs) {
			const { author, count } = msgs[i];

			let user: User = bot.users.get(author);

			if (!user) {
				user = await prisma.users.findUnique({ where: { id: author } }) as User;
			}

			text += `*${Number(i) + 1}.* ${user?.name || author}: *${count}* messages\n`;
		}

		bot.send(msg, text);
		return;
	}
}
