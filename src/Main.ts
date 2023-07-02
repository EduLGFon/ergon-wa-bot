import BotClient from './Client';

const bot = new BotClient('auth_info_baileys');
// auth_info_baileys é uma pasta com autenticação para
// fazer login sem precisar escanear o QR Code novamente

bot.connect();
