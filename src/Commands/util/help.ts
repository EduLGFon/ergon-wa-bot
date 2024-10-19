import type { Cmd, CmdContext } from '../../Components/Typings/index';
import Command from '../../Components/Classes/Command';

export default class extends Command {
	constructor() {
		super({
			aliases: ['ajuda', 'menu', '?'],
		});
	}

	async run({ t, bot, args, msg, user }: CmdContext) {
		const cmdsList = bot.cmds
			.filter((c: Cmd) => !c.access!.onlyDevs)
			.map((c: Cmd) => `➥ *${user.prefix}${c.name}*: ${t(`${c.name}.desc`)}\n`).join('');

		let text = t('help.title') +
			'\n\n' +
			t('help.prefix', { prefix: `${user.prefix}prefix` }) +
			'\n\n' +
			cmdsList;

		if (args[0]) {
			const cmd = bot.cmds.get(args[0]) || bot.cmds.get(bot.aliases.get(args[0]));

			if (cmd) {
				text = `*[📖] - ${cmd.name}*\n\n` +
					t(`${cmd.name}.desc`) +
					'\n\n' +
					user.prefix + cmd.name + ' ' + t(`${cmd.name}.usage`);
			}
		}

		text += '\n\n' + t('help.lang', { lang: `${user.prefix}language` });

		await bot.send(msg, text);
		return true;
	}
}
