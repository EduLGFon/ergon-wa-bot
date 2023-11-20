import { delay, isValidPositiveIntenger } from '../../Core/Components/Utils.js';
import { CmdContext } from '../../Core/Typings/types.js';
import Cmd from '../../Core/Classes/Command.js';

export default class extends Cmd {
	constructor() {
		super({
			cooldown: 10,
		});
	}

	async run({ bot, msg, args, group, sendUsage }: CmdContext) {
		group = group!;
		const amount = Number(args[0]);

		if (amount === 0) {
			return bot.send(
				msg,
				'"clean 0"? Tá achando que aqui é seu quarto que você não limpa nada?',
			);
		}

		if (group.cachedMsgs.size < amount) {
			bot.send(
				msg,
				`Vou apagar as últimas ${group.cachedMsgs.size} mensagens e depois vou voltar a dormir bem aqui na minha rede`,
			);
		}

		if (!isValidPositiveIntenger(amount)) return sendUsage();

		for (const m of group.getCachedMsgs(amount)) {
			await bot.deleteMsg(m);
			group.cachedMsgs.remove(m.id!);

			await delay(300);
		}

		return;
	}
}
