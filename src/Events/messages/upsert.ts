import { devs, prefix } from '../../config.json';
import { proto } from '@whiskeysockets/baileys';
import BotClient from '../../Client';

export default async function (bot: BotClient, rawMsg: { messages: proto.IWebMessageInfo[] }) {
	const m = rawMsg.messages[0];
	if (!m.message) return;

	let timestamp = String(m.messageTimestamp);

	while (timestamp.length < 13) {
		timestamp += '9';
	} // Gambiarra pra fazer as 2 datas terem o mesmo tamanho

	const type = Object.keys(m.message)[0];
	// tipo da msg

	const msg: Msg = {
		id: m.key.id!, // id da msg
		author: m.key.participant || m.key.remoteJid!, // id do autor da msg
		chat: m.key.remoteJid!, // id do chat da msg
		timestamp: Number(timestamp), // data
		username: m.pushName!, // nome do autor da msg
		//@ts-ignore Dependendo do tipo da msg, o texto pode assumir
		// várias propriedades diferentes
		text: String(m.message.conversation || m.message[type]?.text || m.message[type]?.caption)
			.trim(),
		type, // tipo da msg
		raw: m, // obj bruto recebido
	};

	if (!msg.text.startsWith(prefix)) return;

	const args: string[] = msg.text.replace(prefix, '').trim().split(' ');
	const callCmd = args.shift()!.toLowerCase()!;
	// procura o cmd pelo nome no Map de cmds e no Map de aliases
	const cmd = bot.cmds.get(callCmd) || bot.cmds.get(bot.aliases.get(callCmd)!);

	if (!cmd) return;
	if (cmd.access?.onlyDevs && !devs.includes(msg.author)) return;

	try {
		const timeout = setTimeout(
			() => bot.send(msg.chat, { react: { text: '⏳', key: m.key } }),
			1_500,
		);
		// reage na msg do cmd se o bot demorar mais de 1.5s
		// para executar o cmd

		await cmd.run!(bot, msg, args);
		clearTimeout(timeout);
	} catch (e) {
		console.log(`Error on ${cmd.name}: ${e}`);
	}
}
