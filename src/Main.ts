import loadPrototypes from './Core/Components/Prototypes.js';
import loadLocales from './Core/Components/Locales.js';
import Bot from './Core/Classes/Bot.js';
import P from 'pino';

const logger = P.default().child({});
logger.level = 'silent';

loadPrototypes();
loadLocales();
const bot = new Bot('auth', logger);
// auth/ has auth info to login without scan QR Code again

bot.connect();

process // "anti-crash" to handle lib instabilities
	.on(
		'unhandledRejection',
		(e: Error) => console.error(`Unhandled Rej: ${e.stack}`),
	)
	.on('uncaughtException', (e) => console.error(`Uncaught Excep.: ${e?.stack}`))
	.on(
		'uncaughtExceptionMonitor',
		(e) => console.error(`Uncaught Excep.M.: ${e?.stack}`),
	);
