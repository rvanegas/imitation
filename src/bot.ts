import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import { GameSession } from './types';
import * as session from './session';
import { generateImitation } from './imitation';
import { deliverMessages, deliverReveal } from './delivery';

const { BOT_TOKEN } = process.env;
if (!BOT_TOKEN) throw new Error('BOT_TOKEN is required in .env');

export const bot = new Telegraf(BOT_TOKEN);

async function onTimeout(s: GameSession): Promise<void> {
  await deliverReveal(bot, s);
  await bot.telegram.sendMessage(s.userA, 'Session timed out after 1 hour.');
  await bot.telegram.sendMessage(s.userB, 'Session timed out after 1 hour.');
  session.endSession(s);
}

bot.start(async (ctx) => {
  const userId = ctx.from.id;
  const payload = ctx.startPayload;

  if (!payload) {
    const token = session.createInvite(userId);
    const link = `https://t.me/${ctx.botInfo.username}?start=${token}`;
    await ctx.reply(`Share this invite link with your partner:\n${link}`);
  } else {
    const s = session.acceptInvite(payload, userId, onTimeout);
    if (!s) {
      await ctx.reply('Invalid or expired invite link.');
      return;
    }
    await bot.telegram.sendMessage(s.userA, 'Game started!');
    await bot.telegram.sendMessage(s.userB, 'Game started!');
  }
});

bot.command('stop', async (ctx) => {
  const userId = ctx.from.id;
  const s = session.getSessionForUser(userId);
  if (!s) {
    await ctx.reply('No active session.');
    return;
  }
  await deliverReveal(bot, s);
  session.endSession(s);
});

bot.on(message('text'), async (ctx) => {
  const userId = ctx.from.id;
  const s = session.getSessionForUser(userId);
  if (!s) {
    await ctx.reply('Use /start to create an invite link.');
    return;
  }

  session.touchSession(s, onTimeout);
  const partnerId = session.getPartner(s, userId);
  const original = ctx.message.text;
  const imitation = await generateImitation(original);

  await deliverMessages(bot, partnerId, { original, imitation }, s.imitationFirst);
});
