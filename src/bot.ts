import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import { GameSession } from './types';
import * as session from './session';
import { generatePrediction, generateAssessment } from './imitation';
import { getProfile, appendMessage, getName, getOrAssignName, setName, isValidName, getUserIdByName, appendAssessment, getAssessments } from './userProfiles';
import { deliverToSender, deliverToReceiver, deliverToSpectators, deliverRoundResultToSpectators } from './delivery';
import { logSession, updateLog } from './log';

function saveState(s: GameSession): void {
  updateLog(s);
  session.persistSessions();
}

const { BOT_TOKEN } = process.env;
if (!BOT_TOKEN) throw new Error('BOT_TOKEN is required in .env');

export const bot = new Telegraf(BOT_TOKEN);

function stripEmoji(text: string): string {
  return text.replace(/\p{Extended_Pictographic}/gu, '').replace(/\s{2,}/g, ' ').trim();
}

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

export function initSessions(): void {
  session.loadPersistedSessions(onTimeout);
}

async function onTimeout(s: GameSession): Promise<void> {
  await bot.telegram.sendMessage(s.user1, 'Session timed out after 1 hour.');
  await bot.telegram.sendMessage(s.user2, 'Session timed out after 1 hour.');
  logSession(s);
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
  } else {
    if (session.isOwnInvite(payload, userId)) {
      await ctx.reply('This is your own invite link — share it with someone else to start a game.');
      return;
    }

    if (session.getSessionForUser(userId)) {
      await ctx.reply('You are already in a game. Use /stop to end it first.');
      return;
    }

    const joined = session.acceptInvite(payload, userId, onTimeout);
    if (joined) {
      getOrAssignName(userId);
      if (joined.variation === 'original') {
        await bot.telegram.sendMessage(joined.user1, 'Game started! You are the interrogator — ask your first question.');
        await bot.telegram.sendMessage(joined.user2, 'Game started! Your partner is the interrogator. Wait for their first question.');
      } else {
        await bot.telegram.sendMessage(joined.user1, 'Game started! You send the first message.');
        await bot.telegram.sendMessage(joined.user2, 'Game started! Your partner sends the first message.');
      }
      return;
    }

    const watched = session.addSpectator(payload, userId);
    if (watched) {
      getOrAssignName(userId);
      const spectatorCount = watched.spectators.length;
      await ctx.reply('You are now watching this game as a spectator.');
      const notice = `A spectator joined. Spectators watching: ${spectatorCount}`;
      await Promise.all([watched.user1, watched.user2].map(id => bot.telegram.sendMessage(id, notice)));
      return;
    }

    const isPlayer = !!session.getSessionForUser(userId);
    await ctx.reply(isPlayer ? 'You are already a player in this game.' : 'Invalid or expired link.');
  }
});

bot.action(/^var_(symmetric|original)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from!.id;
  const variation = ctx.match[1] as 'symmetric' | 'original';
  getOrAssignName(userId);
  const token = session.createInvite(userId, variation);
  const link = `https://t.me/${ctx.botInfo!.username}?start=${token}`;
  const label = variation === 'original' ? 'Original Turing Test' : 'Symmetric';
  await ctx.editMessageText(`${label} selected.\n\nShare this link — the first to click joins as player 2; everyone else watches:\n${link}`);
});

bot.command('help', async (ctx) => {
  await ctx.reply(
    '/start — Create a new game or join via invite link\n' +
    '/human A|B — Guess which message was written by the human\n' +
    '/invite — Get the session link; first to click joins as player 2, others watch\n' +
    '/status — Show current turn, score, and spectator count\n' +
    '/stop — End the current game and show final scores\n' +
    '/restart <user1> <user2> — Restart the game with two players from the session\n' +
    '/setname <name> — Set your display name\n' +
    '/help — Show this message'
  );
});

bot.command('setname', async (ctx) => {
  const name = ctx.message.text.split(/\s+/)[1] ?? '';
  if (!isValidName(name)) {
    await ctx.reply('Invalid name. Must start with a letter or underscore, contain only letters, digits, or underscores, and be 1–32 characters long.');
    return;
  }
  setName(ctx.from.id, name);
  await ctx.reply(`Name set to: ${name}`);
});

bot.command('invite', async (ctx) => {
  const userId = ctx.from.id;
  const s = session.getSessionForUser(userId);
  if (!s) {
    await ctx.reply('No active session.');
    return;
  }
  const link = `https://t.me/${ctx.botInfo.username}?start=${s.id}`;
  await ctx.reply(`Share this link — the first to click joins as player 2; everyone else watches as a spectator:\n${link}`);
});

bot.command('status', async (ctx) => {
  const userId = ctx.from.id;
  const s = session.getSessionForUser(userId) ?? session.getSessionForSpectator(userId);
  if (!s) {
    await ctx.reply('No active session.');
    return;
  }
  const isSpectator = s.spectators.includes(userId);
  const name1 = getName(s.user1) ?? 'user1';
  const name2 = getName(s.user2) ?? 'user2';

  let turnLine: string;
  if (isSpectator) {
    if (s.variation === 'original') {
      turnLine = s.pendingResponder !== null ? 'Waiting for the witness to answer.' : 'Waiting for the interrogator to ask a question.';
    } else {
      turnLine = s.pendingResponder === null ? 'Waiting for a message.' : 'Waiting for a guess.';
    }
  } else if (s.variation === 'original') {
    const isInterrogator = userId === s.interrogator;
    if (s.pendingResponder !== null) {
      turnLine = isInterrogator ? 'Waiting for your partner to answer.' : 'Your turn to answer.';
    } else {
      turnLine = isInterrogator ? 'Your turn to ask a question.' : 'Waiting for your partner to ask a question.';
    }
  } else {
    if (s.pendingResponder === null) {
      turnLine = userId === s.firstSender ? 'Your turn to send a message.' : 'Waiting for your partner to send a message.';
    } else {
      turnLine = s.pendingResponder === userId ? 'Your turn to guess (/human A or /human B).' : 'Waiting for your partner to guess.';
    }
  }

  let scoreLine: string;
  if (s.variation === 'original') {
    scoreLine = `Score — Humans: ${s.teamScores.humans} | Model: ${s.teamScores.model}`;
  } else if (isSpectator) {
    scoreLine = `Score — ${name1}: ${s.scores.user1} | ${name2}: ${s.scores.user2}`;
  } else {
    const myRole = userId === s.user1 ? 'user1' : 'user2';
    const partnerRole = myRole === 'user1' ? 'user2' : 'user1';
    scoreLine = `Score — You: ${s.scores[myRole]} | Partner: ${s.scores[partnerRole]}`;
  }

  const spectatorNames = s.spectators.map((id, i) => getName(id) ?? `spectator${i + 1}`);
  const spectatorLine = s.spectators.length === 0
    ? 'Spectators: none'
    : `Spectators: ${spectatorNames.join(', ')}`;
  const playersLine = `Players: ${name1}, ${name2}`;

  await ctx.reply(`${playersLine}\n${turnLine}\n${scoreLine}\n${spectatorLine}`);
});

bot.command('restart', async (ctx) => {
  const userId = ctx.from.id;
  const s = session.getSessionForUser(userId) ?? session.getSessionForSpectator(userId);
  if (!s) {
    await ctx.reply('No active session.');
    return;
  }

  const args = ctx.message.text.split(/\s+/);
  const name1 = args[1];
  const name2 = args[2];
  if (!name1 || !name2) {
    await ctx.reply('Usage: /restart <username1> <username2>');
    return;
  }

  const id1 = getUserIdByName(name1);
  const id2 = getUserIdByName(name2);
  if (!id1) { await ctx.reply(`Unknown user: ${name1}`); return; }
  if (!id2) { await ctx.reply(`Unknown user: ${name2}`); return; }
  if (id1 === id2) { await ctx.reply('The two players must be different users.'); return; }

  const allParticipants = [s.user1, s.user2, ...s.spectators];
  if (!allParticipants.includes(id1)) { await ctx.reply(`${name1} is not in this session.`); return; }
  if (!allParticipants.includes(id2)) { await ctx.reply(`${name2} is not in this session.`); return; }

  session.restartWithPlayers(s, id1, id2, onTimeout);

  const msg1 = s.variation === 'original'
    ? 'Game restarted! You are the interrogator — ask your first question.'
    : 'Game restarted! You send the first message.';
  const msg2 = s.variation === 'original'
    ? 'Game restarted! Your partner is the interrogator. Wait for their first question.'
    : 'Game restarted! Your partner sends the first message.';

  await bot.telegram.sendMessage(s.user1, msg1);
  await bot.telegram.sendMessage(s.user2, msg2);
  await Promise.all(s.spectators.map(id => bot.telegram.sendMessage(id, 'Game restarted with new players.')));
});

bot.command('stop', async (ctx) => {
  const userId = ctx.from.id;
  const s = session.getSessionForUser(userId);
  if (!s) {
    await ctx.reply('No active session.');
    return;
  }

  let results: string;
  if (s.variation === 'original') {
    const avgTurns = s.roundCount > 0 ? (s.totalTurns / s.roundCount).toFixed(1) : '—';
    results = `Game over.\nHumans: ${s.teamScores.humans} | Model: ${s.teamScores.model} | Avg turns to guess: ${avgTurns}`;
  } else {
    results = `Game over.\nUser 1: ${s.scores.user1} | User 2: ${s.scores.user2}`;
  }

  const recipients = [s.user1, s.user2, ...s.spectators];
  await Promise.all(recipients.map(id => bot.telegram.sendMessage(id, results)));

  logSession(s);
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
  const partnerId = session.getPartner(s, userId);
  const partnerRole = partnerId === s.user1 ? 'user1' : 'user2';

  const reveal = s.imitationFirst
    ? 'A was the model, B was the human.'
    : 'A was the human, B was the model.';

  const guesserLabel = getName(userId)!;

  if (s.variation === 'original') {
    if (correct) {
      s.teamScores.humans += 1;
    } else {
      s.teamScores.model += 1;
    }
    s.totalTurns += s.currentRoundTurns;
    s.roundCount += 1;
    const verdict = correct ? 'Correct! Humans +1' : 'Wrong! Model +1';
    const avgTurns = s.roundCount > 0
      ? (s.totalTurns / s.roundCount).toFixed(1)
      : '—';
    const scoreStr = `Humans: ${s.teamScores.humans} | Model: ${s.teamScores.model} | Avg turns to guess: ${avgTurns}`;

    s.transcript.push({ role: 'guess', content: `${guess} (${reveal})`, correct, guesser: role as 'user1' | 'user2' });
    saveState(s);

    const _modelEntry1 = s.transcript[s.transcript.length - 2];
    const _humanEntry1 = s.transcript[s.transcript.length - 3];
    if (_modelEntry1?.role === 'model' && _humanEntry1) {
      const _meta1 = {
        sessionId: s.id,
        guessNumber: s.transcript.filter(e => e.role === 'guess').length,
        guesserId: userId,
        correct,
      };
      generateAssessment(s.transcript.slice(0, -3), _humanEntry1.content, _modelEntry1.content, correct)
        .then(assessment => appendAssessment(assessment, _meta1))
        .catch(() => {});
    }

    await deliverRoundResultToSpectators(bot, s, guesserLabel, correct, reveal, s.scores, s.teamScores);
    session.reshuffle(s);

    const youAreNewInterrogator = s.interrogator === userId;
    await ctx.reply(
      `${verdict} ${reveal}\n${scoreStr}\n\n` +
      (youAreNewInterrogator ? 'Your turn to interrogate. Ask your first question.' : 'Your partner is the interrogator now. Wait for their first question.')
    );
    await bot.telegram.sendMessage(
      partnerId,
      `Your partner guessed ${correct ? 'correctly' : 'incorrectly'}. ${reveal}\n${scoreStr}\n\n` +
      (!youAreNewInterrogator ? 'Your turn to interrogate. Ask your first question.' : 'Your partner is the interrogator now. Wait for their first question.')
    );
  } else {
    s.scores[role] += correct ? 1 : -1;
    const myScore = s.scores[role];
    const partnerScore = s.scores[partnerRole];
    const verdict = correct ? 'Correct! +1' : 'Wrong! -1';

    s.transcript.push({ role: 'guess', content: `${guess} (${reveal})`, correct, guesser: role as 'user1' | 'user2' });
    saveState(s);

    const _modelEntry2 = s.transcript[s.transcript.length - 2];
    const _humanEntry2 = s.transcript[s.transcript.length - 3];
    if (_modelEntry2?.role === 'model' && _humanEntry2) {
      const _meta2 = {
        sessionId: s.id,
        guessNumber: s.transcript.filter(e => e.role === 'guess').length,
        guesserId: userId,
        correct,
      };
      generateAssessment(s.transcript.slice(0, -3), _humanEntry2.content, _modelEntry2.content, correct)
        .then(assessment => appendAssessment(assessment, _meta2))
        .catch(() => {});
    }

    await deliverRoundResultToSpectators(bot, s, guesserLabel, correct, reveal, s.scores);
    session.reshuffle(s);

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

  const text = stripEmoji(ctx.message.text);
  if (!text) return;

  if (s.variation === 'original') {
    const witnessId = session.getPartner(s, s.interrogator);

    if (s.pendingResponder === witnessId) {
      // Answer phase — only witness can send
      if (userId !== witnessId) {
        await ctx.reply('Waiting for your partner to respond.');
        return;
      }
      session.touchSession(s, onTimeout);

      const prediction = stripEmoji(s.pendingPrediction!);
      const witnessRole = witnessId === s.user1 ? 'user1' : 'user2';

      session.addToTranscript(s, witnessRole, text);
      session.addToTranscript(s, 'model', prediction);
      appendMessage(witnessId, s.interrogator, text);
      s.pendingPrediction = null;
      s.pendingResponder = null; // back to interrogator's turn
      s.currentRoundTurns += 1;
      saveState(s);

      await ctx.reply(`You: ${text}\nModel: ${prediction}`);
      await deliverToReceiver(bot, s.interrogator, { human: text, prediction }, s.imitationFirst);
      const witnessLabel = getName(witnessId)!;
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
    const { text: predText, systemPrompt: sp1 } = await generatePrediction(s.transcript, witnessRole, profile.messages, text, getAssessments());
    const prediction = stripEmoji(predText);
    s.pendingPrediction = prediction;
    s.lastSystemPrompt = sp1;
    s.pendingResponder = witnessId;

    const interrogatorRole = s.interrogator === s.user1 ? 'user1' : 'user2';
    session.addToTranscript(s, interrogatorRole, text);
    saveState(s);
    appendMessage(s.interrogator, witnessId, text);

    await bot.telegram.sendMessage(witnessId, text);

    if (s.spectators.length > 0) {
      const interrogatorLabel = getName(s.interrogator)!;
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
  const { text: predText2, systemPrompt: sp2 } = await generatePrediction(s.transcript, senderRole, profile.messages, undefined, getAssessments());
  const prediction = stripEmoji(predText2);
  s.lastSystemPrompt = sp2;
  appendMessage(userId, partnerId, text);

  session.addToTranscript(s, senderRole, text);
  session.addToTranscript(s, 'model', prediction);
  s.pendingResponder = partnerId;
  saveState(s);

  const senderLabel = getName(userId)!;
  await deliverToSender(bot, userId, text, prediction);
  await deliverToReceiver(bot, partnerId, { human: text, prediction }, s.imitationFirst);
  await deliverToSpectators(bot, s, senderLabel, text, prediction);
});
