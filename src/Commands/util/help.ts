import type { Cmd, CmdContext } from '../../Core/Typings/index';
import Command from '../../Core/Classes/Command';

export default class extends Command {
	constructor() {
		super({
			aliases: ['ajuda', 'menu', '?'],
		});
	}

	async run({ t, bot, args, msg, user }: CmdContext) {
		const cmdsList = bot.cmds
			.filter((c: Cmd) => !c.access!.onlyDevs)
			.map((c: Cmd) => `➥ *${user.prefix}${c.name}*: ${t(`${c.name}.desc`)}\n`)
			.join('');

		let text = t('help.title') +
			'\n\n' +
			t('help.prefix', { prefix: `${user.prefix}prefix` }) + '\n\n' +
			cmdsList + '\n\n' +
			t('help.lang', { lang: `${user.prefix}language` });

		if (args[0]) {
			const c = bot.cmds.get(args[0]) || bot.cmds.get(bot.aliases.get(args[0]));
			const callCmd = `\n*${user.prefix + c.name}* `;
			const aliases = c.aliases[0] ? `[${c.aliases.join(', ')}]` : '';
			const ex = t(`${c.name}.examples`);

			const examples = Array.isArray(ex)
				? `\n\n${t('usage.examples')}` +
					callCmd + ex.join(callCmd)
				: '';

			if (c.name) {
				text = `*[📖] - ${c.name.toPascalCase()}* ${aliases}\n\n` +
					'➥ ' + t(`${c.name}.desc`) + '\n\n' +
					t('usage.title') + callCmd + t(`${c.name}.usage`) +
					examples + `\n\n${t(`usage.args`)}`;
			}
		}

		return bot.send(msg, text);
	}
}
