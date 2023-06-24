import { MessageUpsertType, proto } from '@whiskeysockets/baileys';
import config from '../../config.json';
import BotClient from '../../Client';

export default async function (bot: BotClient, m: { messages: proto.IWebMessageInfo[]; type: MessageUpsertType }) {
	let timestamp = String(m.messages[0].messageTimestamp);

	while (timestamp.length < 13) {
		timestamp += '9';
	}

	const msg: Msg = {
		id: m.messages[0].key.id!,
		chat: m.messages[0].key.remoteJid!,
		participant: m.messages[0].key.participant!,
		timestamp: Number(timestamp),
		username: m.messages[0].pushName!,
		text: m.messages[0].message?.conversation?.trim()!,
		status: m.messages[0].status!,
	};
	const { devs, prefix } = config;
	// Eu sei que poderia ter feito isso diretamente no import,
	// porém o DENO não aceita isso e estou deixando as coisas preparadas
	// para um possível porte para o DENO no futuro

	if (msg?.text.slice(0, prefix.length) != prefix) return;

	const args: string[] = msg.text.replace(prefix, '').trim().split(' ');
	const cmd = bot.commands.get(args.shift()?.toLowerCase()!);

	if (!cmd) return;
	if (cmd.access?.onlyDevs && !(devs.includes(msg.chat) || devs.includes(msg.participant))) return;

	try {
		await bot.sock.sendPresenceUpdate('composing', msg.chat);
		await cmd.run!(bot, msg, args);
		await bot.sock.sendPresenceUpdate('paused', msg.chat);
	} catch (e) {
		console.log(`Error on ${cmd.name}: ${e}`);
	}
}
