import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import { GameSession } from './types';
import * as session from './session';
import { generatePrediction } from './imitation';
import { getProfile, appendMessage } from './userProfiles';
import { deliverToSender, deliverToReceiver, deliverToSpectators, deliverRoundResultToSpectators } from './delivery';

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
    await ctx.reply(
      'Which variation would you like to play?\n\n' +
      'Symmetric — each player alternates sending a message; the other guesses whether the message is human or AI.\n\n' +
      'Original Turing Test — the interrogator asks questions; the witness answers (with AI imitating the witness); the interrogator guesses, then roles swap.',
      {
        reply_markup: {
          inline_keyboard: [[
            { text: 'Symmetric', callback_data: 'var_symmetric' },
            { text: 'Original Turing Test', callback_data: 'var_original' },
          ]],
        },
      }
    );
  } else if (payload.startsWith('spec_')) {
    const s = session.addSpectator(payload, userId);
    if (!s) {
      await ctx.reply('Invalid or expired spectator link.');
      return;
    }
    await ctx.reply('You are now watching this game as a spectator.');
  } else {
    const s = session.acceptInvite(payload, userId, onTimeout);
    if (!s) {
      await ctx.reply('Invalid or expired invite link.');
      return;
    }
    if (s.variation === 'original') {
      await bot.telegram.sendMessage(s.user1, 'Game started! You are the interrogator — ask your first question.');
      await bot.telegram.sendMessage(s.user2, 'Game started! Your partner is the interrogator. Wait for their first question.');
    } else {
      await bot.telegram.sendMessage(s.user1, 'Game started! You send the first message.');
      await bot.telegram.sendMessage(s.user2, 'Game started! Your partner sends the first message.');
    }
  }
});

bot.action(/^var_(symmetric|original)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from!.id;
  const variation = ctx.match[1] as 'symmetric' | 'original';
  const token = session.createInvite(userId, variation);
  const link = `https://t.me/${ctx.botInfo!.username}?start=${token}`;
  const label = variation === 'original' ? 'Original Turing Test' : 'Symmetric';
  await ctx.editMessageText(`${label} selected.\n\nShare this invite link with your partner:\n${link}`);
});

bot.command('invite', async (ctx) => {
  const userId = ctx.from.id;
  const s = session.getSessionForUser(userId);
  if (!s) {
    await ctx.reply('No active session.');
    return;
  }
  const token = session.createSpectatorInvite(s);
  const link = `https://t.me/${ctx.botInfo.username}?start=${token}`;
  await ctx.reply(`Share this spectator link — anyone can click it to watch:\n${link}`);
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

  if (s.variation === 'original') {
    const hasExchange = s.transcript.some(e => e.role === 'model');
    if (userId !== s.interrogator || s.pendingResponder !== null || !hasExchange) {
      await ctx.reply('It is not your turn to guess, or no exchange has happened yet.');
      return;
    }
  } else if (s.pendingResponder !== userId) {
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

  const guesserLabel = role === 'user1' ? 'User 1' : 'User 2';
  await deliverRoundResultToSpectators(bot, s, guesserLabel, correct, reveal, s.scores);

  session.reshuffle(s);

  if (s.variation === 'original') {
    // After reshuffle, s.interrogator is now the old witness (= partnerId)
    const youAreNewInterrogator = s.interrogator === userId;
    await ctx.reply(
      `${verdict} ${reveal}\nYour score: ${myScore} | Partner's score: ${partnerScore}\n\n` +
      (youAreNewInterrogator ? 'Your turn to interrogate.' : 'Your partner is the interrogator now.')
    );
    await bot.telegram.sendMessage(
      partnerId,
      `Your partner guessed ${correct ? 'correctly' : 'incorrectly'}. ${reveal}\nYour score: ${partnerScore} | Partner's score: ${myScore}\n\n` +
      (!youAreNewInterrogator ? 'Your turn to interrogate.' : 'Your partner is the interrogator now.')
    );
  } else {
    const youGoFirst = s.firstSender === userId;
    await ctx.reply(
      `${verdict} ${reveal}\nYour score: ${myScore} | Partner's score: ${partnerScore}\n\n${youGoFirst ? 'Your turn to send the first message.' : 'Your partner sends the first message.'}`
    );
    await bot.telegram.sendMessage(
      partnerId,
      `Your partner guessed ${correct ? 'correctly' : 'incorrectly'}. ${reveal}\nYour score: ${partnerScore} | Partner's score: ${myScore}\n\n${youGoFirst ? 'Your partner sends the first message.' : 'Your turn to send the first message.'}`
    );
  }
});

bot.on(message('text'), async (ctx) => {
  const userId = ctx.from.id;
  const s = session.getSessionForUser(userId);
  if (!s) {
    await ctx.reply('Use /start to create an invite link.');
    return;
  }

  if (/^human[/\s]*[ab]\b/i.test(ctx.message.text.trim())) {
    await ctx.reply('Looks like you meant to guess. Use /human A or /human B.');
    return;
  }

  const text = ctx.message.text;

  if (s.variation === 'original') {
    const witnessId = session.getPartner(s, s.interrogator);

    if (s.pendingResponder === witnessId) {
      // Answer phase — only witness can send
      if (userId !== witnessId) {
        await ctx.reply('Waiting for your partner to respond.');
        return;
      }
      session.touchSession(s, onTimeout);

      const prediction = s.pendingPrediction!;
      const witnessRole = witnessId === s.user1 ? 'user1' : 'user2';

      session.addToTranscript(s, witnessRole, text);
      session.addToTranscript(s, 'model', prediction);
      appendMessage(witnessId, s.interrogator, text);
      s.pendingPrediction = null;
      s.pendingResponder = null; // back to interrogator's turn

      await ctx.reply('Response sent.');
      await deliverToReceiver(bot, s.interrogator, { human: text, prediction }, s.imitationFirst);
      await bot.telegram.sendMessage(s.interrogator, 'Ask another question, or use /human A or /human B to guess.');
      const witnessLabel = witnessRole === 'user1' ? 'User 1' : 'User 2';
      await deliverToSpectators(bot, s, witnessLabel, text, prediction);
      return;
    }

    // Interrogator's turn (pendingResponder === null) — only interrogator can send
    if (userId !== s.interrogator) {
      await ctx.reply('Waiting for your partner to ask a question.');
      return;
    }
    session.touchSession(s, onTimeout);

    const witnessRole = witnessId === s.user1 ? 'user1' : 'user2';
    const profile = getProfile(witnessId, s.interrogator);
    const prediction = await generatePrediction(s.transcript, witnessRole, profile.messages, text);
    s.pendingPrediction = prediction;
    s.pendingResponder = witnessId;

    const interrogatorRole = s.interrogator === s.user1 ? 'user1' : 'user2';
    session.addToTranscript(s, interrogatorRole, text);
    appendMessage(s.interrogator, witnessId, text);

    await ctx.reply('Sent. Waiting for your partner\'s response.');
    await bot.telegram.sendMessage(witnessId, `${text}\n\nSend your response.`);

    if (s.spectators.length > 0) {
      const interrogatorLabel = interrogatorRole === 'user1' ? 'User 1' : 'User 2';
      await Promise.all(s.spectators.map(id =>
        bot.telegram.sendMessage(id, `${interrogatorLabel} (interrogator): ${text}`)
      ));
    }
    return;
  }

  // Symmetric variation
  if (s.pendingResponder !== null && s.pendingResponder !== userId) {
    await ctx.reply('Waiting for your partner to respond.');
    return;
  }

  session.touchSession(s, onTimeout);

  const senderRole = userId === s.user1 ? 'user1' : 'user2';
  const partnerId = session.getPartner(s, userId);

  const profile = getProfile(userId, partnerId);
  const prediction = await generatePrediction(s.transcript, senderRole, profile.messages);
  appendMessage(userId, partnerId, text);

  session.addToTranscript(s, senderRole, text);
  session.addToTranscript(s, 'model', prediction);
  s.pendingResponder = partnerId;

  const senderLabel = senderRole === 'user1' ? 'User 1' : 'User 2';
  await deliverToSender(bot, userId, text, prediction);
  await deliverToReceiver(bot, partnerId, { human: text, prediction }, s.imitationFirst);
  await deliverToSpectators(bot, s, senderLabel, text, prediction);
});
