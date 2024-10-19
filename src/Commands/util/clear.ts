import Command from "../../Core/Classes/Command.js";
import { CmdContext } from "../../Core/Typings/types.js";

export default class extends Command {
    constructor () {
        super({
            aliases: ["clr"]
        });
    }

    async run ({ t, bot, msg, args, user, group }: CmdContext) {
        console.log("clear 1")
        bot.send(msg.chat, "Tá pronto n vlw");
        /* const msgsQnt = Number(args[0]);
        group?.getLastMsgs(msgsQnt).forEach(groupMsg => {
            bot.send(msg.chat, { delete: groupMsg.key });
        }); */

        return;
    }
}