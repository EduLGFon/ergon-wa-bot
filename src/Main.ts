import loadPrototypes from './Core/Components/Prototypes';
import loadLocales from './Core/Components/Locales';
import MAIN_LOGGER from 'baileys/lib/Utils/logger';
import Bot from './Core/Classes/Bot';

const logger = MAIN_LOGGER.child({});
logger.level = 'warn';

loadPrototypes();
loadLocales();
const bot = new Bot('auth', logger);
// auth/ has auth info to login without scan QR Code again

bot.connect();

process // "anti-crash" to handle lib instabilities
	.on('unhandledRejection', (e: any) => console.error('[ANTI-CRASH', `Unhandled Rej: ${e?.stack}`))
	.on('uncaughtException', (e) => console.error('[ANTI-CRASH', `Uncaught Excep.: ${e?.stack}`))
	.on('uncaughtExceptionMonitor', (e) => console.error('[ANTI-CRASH', `Uncaught Excep.M.: ${e?.stack}`));
