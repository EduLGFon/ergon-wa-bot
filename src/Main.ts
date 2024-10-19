import BotClient from './Client';
import { prefix } from './Settings.json';

async function connectToWhatsApp() {
	const bot = new BotClient('auth_info_baileys', prefix);

	bot.events.msgUpsert = async (m) => {
		if (m.text === '.ping') bot.send(m.chat, `Ping: ${Date.now() - m.timestamp}ms`);
	};
	await bot.connect();
}

connectToWhatsApp();
