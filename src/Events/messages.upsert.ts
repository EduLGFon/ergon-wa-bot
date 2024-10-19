import { MessageUpsertType, proto } from "@whiskeysockets/baileys";
import { prefix } from "../Settings.json";
import BotClient from "../Client";

export default async function (m: { messages: proto.IWebMessageInfo[]; type: MessageUpsertType }, bot: BotClient) {
    let timestamp = String(m.messages[0].messageTimestamp)

    while (timestamp.length < 13)
        timestamp += '0'


    const msg: Msg = {
        id: m.messages[0].key.id!,
        chat: m.messages[0].key.remoteJid!,
        participant: m.messages[0].key.participant!,
        timestamp: Number(timestamp),
        username: m.messages[0].pushName!,
        text: m.messages[0].message?.conversation?.trim()!,
        status: m.messages[0].status!
    }

    if (msg.text.slice(prefix.length) !== bot.prefix) return;

    const args: string[] = msg.text.replace(prefix, '').trim().split(' ');
    const cmd = bot.commands.get(args.shift()?.toLowerCase()!)

    if (!cmd) return;

    try {
        bot.sock.sendPresenceUpdate("composing", msg.chat);
        await cmd.run(msg, bot);
        bot.sock.sendPresenceUpdate("available", msg.chat);
    } catch (e) {
        console.log(`Error on ${cmd.name}: ${e}`);
    }
}