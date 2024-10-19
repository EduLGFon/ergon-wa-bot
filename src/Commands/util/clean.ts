import { CmdContext } from "../../Core/Typings/types.js";
import Command from "../../Core/Classes/Command.js";

export default class extends Command {
    limit: number;

    constructor () {
        super({
            cooldown: 10
        });

        this.limit = 20;
    }

    async run ({ bot, msg, args, group }: CmdContext) {
        let qnt = Number(args[0]);

        if (qnt === 0) return bot.send(msg.chat, "\"clean 0\" ? Tá achando que aqui é seu quarto que você não limpa nada?");
        if (Number.isNaN(qnt) || qnt < 0 || !Number.isInteger(qnt)) return bot.send(msg.chat, "Oi amigo, você esqueceu de dizer quantas mensagens você quer limpar, ou informou da forma incorreta ☝️");
        qnt = qnt > this.limit ? this.limit : qnt;

        const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

        group?.getCachedMsgs(qnt).forEach(async groupMsg => {
            await bot.send(msg.chat, { delete: groupMsg.key });
            group.cachedMsgs.delete(groupMsg.id);
            await sleep(200);
        });

        return;
    }
}
