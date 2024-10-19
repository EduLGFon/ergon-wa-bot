import { downloadMediaMessage } from '@whiskeysockets/baileys';
import BotClient from '../../Client';
import { writeFileSync } from 'fs';

export default class implements Command {
	public aliases = ['s', 'makesticker'];
	public access = { dm: true, group: true };
	public cooldown = 0;
	public run = async (bot: BotClient, msg: Msg) => {
		if (msg.type !== 'imageMessage') return;

		const buffer = await downloadMediaMessage(msg.raw, 'buffer', {})! as Buffer;

		bot.send(msg.chat, { sticker: buffer, gifPlayback: true }, msg.raw);
	};
}
