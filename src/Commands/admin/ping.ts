import type { CmdContext } from '../../Core/Typings/types.js';
import prisma from '../../Core/Components/Prisma.js';
import Cmd from '../../Core/Classes/Command.js';

export default class extends Cmd {
	constructor() {
		super({
			aliases: ['p'],
		});
	}
	async run({ t, bot, user, msg }: CmdContext) {
		// Calculate WA Ping
		let startTime = Date.now();
		await bot.react(msg, '⌛');
		const WAPing = Date.now() - startTime;

		// Calculate DB Ping
		startTime = Date.now();
		await prisma.users.findUnique({ where: { id: user.id } });
		const DBPing = Date.now() - startTime;

		bot.send(
			msg,
			`*[🐧] - Ping:*\n[📞] WA API: *${WAPing}ms*\n[🐘] PostgreSQL: *${DBPing}ms*`,
		);
		bot.react(msg, '✅');
		return;
	}
}
