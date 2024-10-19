import { proto } from "baileys";
import { Msg } from "../Typings/types.js";

export default class Messages  {
    id: string | null | undefined;
    author: string | null | undefined;
    chat: string;
    key: proto.IMessageKey

    constructor (originalMsg: Msg) {
        this.id = originalMsg.key.id
        this.author = originalMsg.key.participant;
        this.chat = originalMsg.chat;
        this.key = originalMsg.key;
    }
}