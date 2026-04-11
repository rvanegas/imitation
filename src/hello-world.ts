import { Telegraf } from 'telegraf';
import { BOT_TOKEN } from './config';

const CHANNEL_ID = process.env.CHANNEL_ID;

if (!BOT_TOKEN) throw new Error('bot_token is required in config.toml');
if (!CHANNEL_ID) throw new Error('CHANNEL_ID env var is required');

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
