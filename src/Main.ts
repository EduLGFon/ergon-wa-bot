import MAIN_LOGGER from 'baileys/lib/Utils/logger';
import Bot from './Core/Bot';

const logger = MAIN_LOGGER.child({});
logger.level = 'info';

const bot = new Bot('auth_info_baileys', logger);
// auth_info_baileys é uma pasta com autenticação para
// fazer login sem precisar escanear o QR Code novamente

bot.connect();

process // mini anti-crash pra segurar as instabilidades da lib
	.on('Uhandled Rej.', (e) => console.log('Unhandled Rejection: ', e?.stack))
	.on('Uncaught Excep.', (e) => console.log('Uncaught Exception: ', e?.stack))
	.on('Uncaught Excep.', (e) => console.log('Uncaught Exception Monitor: ', e?.stack));
