import type { Cmd, CmdContext } from '../../Components/Typings/index';
import Command from '../../Components/Classes/Command';

export default class extends Command {
	constructor() {
		super({
			aliases: ['ajuda', 'menu', '?'],
		});
	}

	async run({ t, bot, msg, user }: CmdContext) {
		const text = [
			t('help.title'),
			'\n\n',
			t('help.desc', { prefix: `${user.prefix}prefix` }),
			'\n\n',
			bot.cmds
				.filter((c: Cmd) => !c.access!.onlyDevs)
				.map((c: Cmd) => `➥ *${user.prefix}${c.name}* ${t(`usage:${c.name}`)}\n`).join(''),
			'\n\n' + t('help.lang', { lang: `${user.prefix}language`, lng: 'en' }),
		];

		await bot.send(msg, text.join(' '));
		return true;
	}
}
