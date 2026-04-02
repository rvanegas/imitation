import { Telegraf } from 'telegraf';
import * as dotenv from 'dotenv';

dotenv.config();

const { BOT_TOKEN, CHANNEL_ID } = process.env;

if (!BOT_TOKEN) throw new Error('BOT_TOKEN is required in .env');
if (!CHANNEL_ID) throw new Error('CHANNEL_ID is required in .env');

const bot = new Telegraf(BOT_TOKEN);

// Write: send a hello world message to the channel on startup
bot.telegram.sendMessage(CHANNEL_ID, 'Hello World from the bot!')
  .then(() => console.log(`Sent "Hello World" to ${CHANNEL_ID}`))
  .catch((err) => console.error('Failed to send message:', err.message));

// Read: log every post made in the channel
bot.on('channel_post', (ctx) => {
  const post = ctx.channelPost;
  const text = 'text' in post ? post.text : '(non-text content)';
  console.log('New channel post:', text);
});

bot.launch();
console.log('Bot is running. Listening for channel posts...');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
