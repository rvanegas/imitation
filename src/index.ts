import * as dotenv from 'dotenv';
dotenv.config();

import { bot, initSessions } from './bot';

initSessions();
bot.launch();
console.log('Bot running.');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
