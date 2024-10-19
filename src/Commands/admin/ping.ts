import { CmdContext } from '../../Components/Typings/index';
import Command from '../../Components/Classes/Command';

export default class extends Command {
	constructor() {
		super({
			aliases: ['p'],
		});
	}
	async run({ t, bot, msg, prisma }: CmdContext) {
		// Calculate WA Ping
		let startTime = Date.now();
		await bot.send(msg.chat, t('ping'));
		const WAPing = Date.now() - startTime;

		// Calculate DB Ping
		startTime = Date.now();
		await prisma.users.findUnique({ where: { id: msg.author } });
		const DBPing = Date.now() - startTime;

		await bot.send(
			msg,
			`*[🐧] - Ping:*\n[📞] WhatsApp: *${WAPing}ms*\n[🐘] PostgreSQL: *${DBPing}ms*`,
		);
		return true;
	}
}
