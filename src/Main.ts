import loadPrototypes from './Components/Plugins/Prototypes';
import loadLocales from './Components/Core/Locales';
import MAIN_LOGGER from 'baileys/lib/Utils/logger';
import Bot from './Components/Classes/Bot';

const logger = MAIN_LOGGER.child({});
logger.level = 'info';

loadPrototypes();
loadLocales();
const bot = new Bot('auth', logger);
// auth/ has auth info to login without scan QR Code again

bot.connect();

process // anti-crash to handle lib instabilities
	.on('Uhandled Rej.', (e) => console.log('Unhandled Rejection: ', e?.stack))
	.on('Uncaught Excep.', (e) => console.log('Uncaught Exception: ', e?.stack))
	.on('Uncaught Excep.', (e) => console.log('Uncaught Exception Monitor: ', e?.stack));
