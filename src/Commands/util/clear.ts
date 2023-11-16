import Command from "../../Core/Classes/Command.js";
import { CmdContext } from "../../Core/Typings/types.js";

export default class extends Command {
    constructor () {
        super({
            aliases: ["clr"]
        });
    }

    async run ({ bot, msg, args, group }: CmdContext) {
        const qnt = Number(args[0]) > 20 ? 20 : Number(args[0]);
        const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

        group?.getCachedMsgs(qnt).forEach(async groupMsg => {
            await bot.send(msg.chat, { delete: groupMsg.key });
            group.cachedMsgs.delete(groupMsg.id);
            await sleep(200);
        });

        return;
    }
}