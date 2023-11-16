import Command from "../../Core/Classes/Command.js";
import { CmdContext } from "../../Core/Typings/types.js";

export default class extends Command {
    limit: number;

    constructor () {
        super({
            aliases: ["clr"]
        });

        this.limit = 20;
    }

    async run ({ bot, msg, args, group }: CmdContext) {
        let qnt = Number(args[0]);
        if (Number.isNaN(qnt) || Number(qnt) <= 0) return bot.send(msg.chat, "Oi amigo, você esqueceu de dizer quantas menssagens você quer limpar, ou informou da forma incorreta ☝️");
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