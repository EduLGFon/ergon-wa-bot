import { proto } from '@whiskeysockets/baileys';
import config from '../../config.json';
import BotClient from '../../Client';

export default async function (bot: BotClient, rawMsg: { messages: proto.IWebMessageInfo[] }) {
	const m = rawMsg.messages[0];
	if (!m.message) return;

	let timestamp = String(m.messageTimestamp);

	while (timestamp.length < 13) {
		timestamp += '9';
	}

	const type = Object.keys(m.message)[0];

	const msg: Msg = {
		id: m.key.id!,
		chat: m.key.remoteJid!,
		participant: m.key.participant!,
		timestamp: Number(timestamp),
		username: m.pushName!,
		//@ts-ignore O nome do obj muda de acordo com o tipo de msg, e a propriedade
		// do texto também.
		text: String(m.message.conversation || m.message[type]?.text || m.message[type]?.caption)
			.trim(),
		type,
		//@ts-ignore mesmo motivo.
		raw: m,
	};

	const { devs, prefix } = config;
	// Eu sei que poderia ter feito isso diretamente no import,
	// porém o DENO não aceita isso e estou deixando as coisas preparadas
	// para um possível porte para o DENO no futuro

	if (msg?.text?.slice(0, prefix.length) != prefix) return;

	const args: string[] = msg.text.replace(prefix, '').trim().split(' ');
	const callCmd = args.shift()?.toLowerCase()!;
	const cmd = bot.cmds.get(callCmd) || bot.cmds.get(bot.aliases.get(callCmd)!);

	if (!cmd) return;
	if (cmd.access?.onlyDevs && !(devs.includes(msg.chat) || devs.includes(msg.participant))) {
		return;
	}

	try {
		const timeout = setTimeout(
			() => bot.send(msg.chat, { react: { text: '⏳', key: m.key } }),
			// Esse timeout vai reagir no cmd se ele demorar mais de 1.5s
			// para ser respondido
			1_500,
		);

		await cmd.run!(bot, msg, args);
		clearTimeout(timeout);
	} catch (e) {
		console.log(`Error on ${cmd.name}: ${e}`);
	}
}
