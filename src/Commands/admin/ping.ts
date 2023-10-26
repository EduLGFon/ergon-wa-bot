import type { CmdContext } from '../../Core/Typings/types.js';
import pg from '../../Core/Components/PostgreSQL.js';
import Command from '../../Core/Classes/Command.js';

export default class extends Command {
	constructor() {
		super({
			aliases: ['p'],
		});
	}
	async run({ t, bot, user, msg }: CmdContext) {
		// Calculate WA Ping
		let startTime = Date.now();
		await bot.send(msg.chat, t('ping.pinging'));
		const WAPing = Date.now() - startTime;

		// Calculate DB Ping
		startTime = Date.now();
		await pg.users.find({ id: user.id });
		const DBPing = Date.now() - startTime;

		bot.send(
			msg,
			`*[🐧] - Ping:*\n[📞] WhatsApp: *${WAPing}ms*\n[🐘] PostgreSQL: *${DBPing}ms*`,
		);
		return;
	}
}
