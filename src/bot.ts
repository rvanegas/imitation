import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import { GameSession } from './types';
import * as session from './session';
import { generatePrediction } from './imitation';
import { getProfile, appendMessage } from './userProfiles';
import { deliverToSender, deliverToReceiver } from './delivery';

const { BOT_TOKEN } = process.env;
if (!BOT_TOKEN) throw new Error('BOT_TOKEN is required in .env');

export const bot = new Telegraf(BOT_TOKEN);

bot.use((ctx, next) => {
  if (ctx.message && 'text' in ctx.message) {
    const cmdEntity = ctx.message.entities?.find(
      e => e.type === 'bot_command' && e.offset === 0
    );
    if (cmdEntity) {
      const t = ctx.message.text;
      (ctx.message as { text: string }).text =
        t.slice(0, cmdEntity.length).toLowerCase() + t.slice(cmdEntity.length);
    }
  }
  return next();
});

async function onTimeout(s: GameSession): Promise<void> {
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
    await bot.telegram.sendMessage(s.user1, 'Game started! You send the first message.');
    await bot.telegram.sendMessage(s.user2, 'Game started! Your partner sends the first message.');
  }
});

bot.command('stop', async (ctx) => {
  const userId = ctx.from.id;
  const s = session.getSessionForUser(userId);
  if (!s) {
    await ctx.reply('No active session.');
    return;
  }
  session.endSession(s);
});

bot.command('human', async (ctx) => {
  const userId = ctx.from.id;
  const s = session.getSessionForUser(userId);
  if (!s) {
    await ctx.reply('No active session.');
    return;
  }

  if (s.pendingResponder !== userId) {
    await ctx.reply('It is not your turn to guess, or no message to guess on.');
    return;
  }

  const args = ctx.message.text.split(/\s+/);
  const guess = args[1]?.toUpperCase();
  if (guess !== 'A' && guess !== 'B') {
    await ctx.reply('Usage: /human A  or  /human B');
    return;
  }

  // imitationFirst=true → A=model, B=human; false → A=human, B=model
  const humanIsA = !s.imitationFirst;
  const correct = (guess === 'A') === humanIsA;

  const role = userId === s.user1 ? 'user1' : 'user2';
  s.scores[role] += correct ? 1 : -1;

  const reveal = s.imitationFirst
    ? 'A was the model, B was the human.'
    : 'A was the human, B was the model.';
  const verdict = correct ? 'Correct! +1' : 'Wrong! -1';

  const partnerId = session.getPartner(s, userId);
  const partnerRole = partnerId === s.user1 ? 'user1' : 'user2';

  const myScore = s.scores[role];
  const partnerScore = s.scores[partnerRole];

  session.reshuffle(s);

  const youGoFirst = s.firstSender === userId;
  await ctx.reply(
    `${verdict} ${reveal}\nYour score: ${myScore} | Partner's score: ${partnerScore}\n\n${youGoFirst ? 'Your turn to send the first message.' : 'Your partner sends the first message.'}`
  );
  await bot.telegram.sendMessage(
    partnerId,
    `Your partner guessed ${correct ? 'correctly' : 'incorrectly'}. ${reveal}\nYour score: ${partnerScore} | Partner's score: ${myScore}\n\n${youGoFirst ? 'Your partner sends the first message.' : 'Your turn to send the first message.'}`
  );
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

  const profile = getProfile(userId, partnerId);
  const prediction = await generatePrediction(s.transcript, senderRole, profile.messages);
  appendMessage(userId, partnerId, text);

  session.addToTranscript(s, senderRole, text);
  session.addToTranscript(s, 'model', prediction);
  s.pendingResponder = partnerId;

  await deliverToSender(bot, userId, text, prediction);
  await deliverToReceiver(bot, partnerId, { human: text, prediction }, s.imitationFirst);
});
