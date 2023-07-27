import MAIN_LOGGER from 'baileys/lib/Utils/logger';
import { makeInMemoryStore } from 'baileys';
import BotClient from './Client';

const logger = MAIN_LOGGER.child({});
logger.level = 'info';

const store = makeInMemoryStore({ logger });
// mantém os dados da conexão na memória pra serem usados depois

const bot = new BotClient('auth_info_baileys', logger, store);
// auth_info_baileys é uma pasta com autenticação para
// fazer login sem precisar escanear o QR Code novamente

bot.connect();

process // mini anti-crash pra segurar as instabilidades da lib
	.on('Uhandled Rej.', (e) => console.log('Unhandled Rejection: ', e?.stack))
	.on('Uncaught Excep.', (e) => console.log('Uncaught Exception: ', e?.stack))
	.on('Uncaught Excep.', (e) => console.log('Uncaught Exception Monitor: ', e?.stack));
