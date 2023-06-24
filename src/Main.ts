import BotClient from './Client';

async function connectToWhatsApp() { // DENO point
	const bot = new BotClient('auth_info_baileys');
	// auth_file é uma pasta com autenticação para fazer login
	// sem precisar escanear o QR Code novamente

	bot.connect();
}

connectToWhatsApp();
