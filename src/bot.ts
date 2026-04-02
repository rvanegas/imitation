import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import { GameSession } from './types';
import * as session from './session';
import { generatePrediction } from './imitation';
import { deliverToSender, deliverToReceiver, deliverReveal } from './delivery';

const { BOT_TOKEN } = process.env;
if (!BOT_TOKEN) throw new Error('BOT_TOKEN is required in .env');

export const bot = new Telegraf(BOT_TOKEN);

async function onTimeout(s: GameSession): Promise<void> {
  await deliverReveal(bot, s);
  await bot.telegram.sendMessage(s.user1, 'Session timed out after 1 hour.');
  await bot.telegram.sendMessage(s.user2, 'Session timed out after 1 hour.');
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
    await bot.telegram.sendMessage(s.user1, 'Game started!');
    await bot.telegram.sendMessage(s.user2, 'Game started!');
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

  if (s.pendingResponder !== null && s.pendingResponder !== userId) {
    await ctx.reply('Waiting for your partner to respond.');
    return;
  }

  session.touchSession(s, onTimeout);

  const senderRole = userId === s.user1 ? 'user1' : 'user2';
  const partnerId = session.getPartner(s, userId);
  const text = ctx.message.text;

  const prediction = await generatePrediction(s.transcript, senderRole);

  session.addToTranscript(s, senderRole, text);
  session.addToTranscript(s, 'model', prediction);
  s.pendingResponder = partnerId;

  await deliverToSender(bot, userId, text, prediction);
  await deliverToReceiver(bot, partnerId, { human: text, prediction }, s.imitationFirst);
});
