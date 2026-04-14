import { GameSession, UserId } from './types';
import { Transport } from './transport';
import * as session from './session';
import { generatePrediction, generateAssessment, buildCachedBlock, checkMessageFairness } from './imitation';
import {
  getProfile, appendMessage, getName, getOrAssignName, setName,
  isValidName, getUserIdByName, appendAssessment, getAssessmentsWithMeta,
  getLatestAssessmentForSession, touchUserSession,
} from './userProfiles';
import {
  deliverToSender, deliverToReceiver, deliverToSpectators,
  deliverRoundResultToSpectators,
} from './delivery';
import { logSession, updateLog } from './log';
import { diagNoSession } from './diag';

function hasPlayers(s: GameSession): s is GameSession & { user1: UserId; user2: UserId } {
  return s.user1 !== null && s.user2 !== null;
}

// Called when a game becomes active (join or restart) to snapshot baseline state for prompt caching.
function initGameCache(s: GameSession & { user1: UserId; user2: UserId }): void {
  const user1Profile = getProfile(s.user1, s.user2);
  const user2Profile = getProfile(s.user2, s.user1);
  const allAssessments = getAssessmentsWithMeta();
  s.baseUser1MsgCount = user1Profile.messages.length;
  s.baseUser2MsgCount = user2Profile.messages.length;
  s.baseAssessmentCount = allAssessments.length;
  s.cachedSystemPromptBlock = buildCachedBlock(
    {
      user1: { id: s.user1, name: getName(s.user1) ?? 'user1', messages: user1Profile.messages },
      user2: { id: s.user2, name: getName(s.user2) ?? 'user2', messages: user2Profile.messages },
    },
    allAssessments,
  );
}

// Lazily rebuilds cachedSystemPromptBlock after a server restart using persisted base counts.
function ensureGameCache(s: GameSession & { user1: UserId; user2: UserId }): void {
  if (s.cachedSystemPromptBlock) return;
  const base1 = s.baseUser1MsgCount ?? 0;
  const base2 = s.baseUser2MsgCount ?? 0;
  const baseA = s.baseAssessmentCount ?? 0;
  s.cachedSystemPromptBlock = buildCachedBlock(
    {
      user1: { id: s.user1, name: getName(s.user1) ?? 'user1', messages: getProfile(s.user1, s.user2).messages.slice(0, base1) },
      user2: { id: s.user2, name: getName(s.user2) ?? 'user2', messages: getProfile(s.user2, s.user1).messages.slice(0, base2) },
    },
    getAssessmentsWithMeta().slice(0, baseA),
  );
}

function getDeltas(s: GameSession & { user1: UserId; user2: UserId }) {
  return {
    deltaMessages: {
      user1: getProfile(s.user1, s.user2).messages.slice(s.baseUser1MsgCount ?? 0),
      user2: getProfile(s.user2, s.user1).messages.slice(s.baseUser2MsgCount ?? 0),
    },
    deltaAssessments: getAssessmentsWithMeta().slice(s.baseAssessmentCount ?? 0),
  };
}

// Human score = h/total * 2 - 1  (ranges –1 to +1; 0 = random chance)
// Model score = 1 – (m/total * 2 – 1) = 2h/total  (0 when humans perfect; 1 when even)
// Human score = h/total * 2 - 1  (ranges –1 to +1; 0 = random chance)
// Model score = 1 – (m/total * 2 – 1) = 2h/total  (0 when humans perfect; 1 when even)
function formatOriginalScores(s: GameSession): string {
  const h = s.teamScores.humans;
  const m = s.teamScores.model;
  const total = h + m;
  if (total === 0) return 'No rounds yet';
  const humanScore = Math.round(h / total * 200 - 100);
  const modelScore = Math.round(m / total * 200);
  const streak = s.winStreak ?? 0;
  const longest = s.longestWinStreak ?? 0;
  return `Humans: ${h} (${humanScore}%) | Model: ${m} (${modelScore}%) | Streak: ${streak} (best: ${longest})`;
}

function formatOriginalScoreStr(s: GameSession): string {
  const avgTurns = s.roundCount > 0 ? (s.totalTurns / s.roundCount).toFixed(1) : '—';
  return `${formatOriginalScores(s)} | Avg turns: ${avgTurns}`;
}

function stripEmoji(text: string): string {
  return text.replace(/\p{Extended_Pictographic}/gu, '').replace(/\s{2,}/g, ' ').trim();
}

function saveState(s: GameSession): void {
  updateLog(s);
  session.persistSessions();
}

export function initSessions(transport: Transport): void {
  session.setTimeoutCallback(async (s: GameSession) => {
    logSession(s);
    session.endSession(s);
  });
  session.loadPersistedSessions();
}

export const HELP_TEXT =
  '/start — Create a new Turing Test game\n' +
  '/human A|B — Guess which message was written by the human\n' +
  '/invite — Get the session invite; first to join becomes player 2, others watch\n' +
  '/status — Show current turn, score, and spectator count\n' +
  '/reflection — Show the AI\'s assessment of the most recent guess\n' +
  '/leave — Leave the current session\n' +
  '/restart <user1> <user2> — Restart the game with two players from the session\n' +
  '/setname <name> — Set your display name\n' +
  '/help — Show this message';

export async function handleStart(
  userId: UserId,
  transport: Transport,
): Promise<void> {
  getOrAssignName(userId);

  const existing = session.getSessionForParticipant(userId);
  if (existing) {
    const name = getName(userId) ?? 'Someone';
    if (session.isPlayer(existing, userId)) {
      const partner = session.getPartner(existing, userId);
      const others = [partner, ...existing.spectators].filter((id): id is UserId => id !== null);
      session.removePlayer(existing, userId);
      await Promise.all(others.map(id => transport.send(id, `${name} left the session.`)));
    } else {
      session.removeSpectator(existing, userId);
    }
    if (existing.user1 === null && existing.user2 === null && existing.spectators.length === 0) {
      logSession(existing);
      session.endSession(existing);
    }
  }

  const sessionToken = session.createInvite(userId);
  const link = transport.makeInviteLink(sessionToken, userId);
  await transport.send(
    userId,
    `Share this link — the first to join becomes player 2; everyone else watches:\n${link}`,
  );
}

export async function handleJoin(
  userId: UserId,
  sessionToken: string,
  transport: Transport,
): Promise<void> {
  if (session.isOwnInvite(sessionToken, userId)) {
    await transport.send(userId, 'This is your own invite — share it with someone else to start a game.');
    return;
  }

  const existing = session.getSessionForParticipant(userId);
  if (existing) {
    const name = getName(userId) ?? 'A player';
    if (existing.user1 === userId || existing.user2 === userId) {
      const partner = session.getPartner(existing, userId);
      const others = [partner, ...existing.spectators].filter((id): id is UserId => id !== null);
      session.removePlayer(existing, userId);
      await Promise.all(others.map(id =>
        transport.send(id, `${name} left to join another game.`)
      ));
    } else {
      session.removeSpectator(existing, userId);
    }
  }

  const joined = session.acceptInvite(sessionToken, userId);
  if (joined) {
    getOrAssignName(userId);
    touchUserSession(userId);
    touchUserSession(joined.user1!);
    initGameCache(joined as GameSession & { user1: UserId; user2: UserId });
    session.persistSessions();
    await transport.send(joined.user2!, HELP_TEXT);
    await transport.send(joined.user1!, 'Game started! You are the interrogator — ask your first question.');
    await transport.send(joined.user2!, 'Game started! Your partner is the interrogator. Wait for their first question.');
    return;
  }

  const watched = session.addSpectator(sessionToken, userId);
  if (watched) {
    getOrAssignName(userId);
    touchUserSession(userId);
    const spectatorCount = watched.spectators.length;
    await transport.send(userId, HELP_TEXT);
    await transport.send(userId, 'You are now watching this game as a spectator.');
    const notice = `A spectator joined. Spectators watching: ${spectatorCount}`;
    await Promise.all([watched.user1, watched.user2].filter((id): id is UserId => id !== null).map(id => transport.send(id, notice)));
    return;
  }

  const isParticipant = !!session.getSessionForParticipant(userId);
  await transport.send(userId, isParticipant ? 'You are already in this session.' : 'Invalid or expired invite.');
}

export async function handleHelp(userId: UserId, transport: Transport): Promise<void> {
  await transport.send(userId, HELP_TEXT);
}


export async function handleSetName(userId: UserId, name: string, transport: Transport): Promise<void> {
  if (!isValidName(name)) {
    await transport.send(
      userId,
      'Invalid name. Must start with a letter or underscore, contain only letters, digits, or underscores, and be 1–32 characters long.',
    );
    return;
  }
  const existing = getUserIdByName(name);
  if (existing !== undefined && existing !== userId) {
    await transport.send(userId, `Name "${name}" is already taken.`);
    return;
  }
  setName(userId, name);
  await transport.send(userId, `Name set to: ${name}`);
}

export async function handleReflection(userId: UserId, transport: Transport): Promise<void> {
  const s = session.getSessionForParticipant(userId);
  if (!s) {
    await transport.send(userId, 'No active session.');
    return;
  }
  const assessment = getLatestAssessmentForSession(s.id);
  if (!assessment) {
    await transport.send(userId, 'No reflection available yet — complete a round first.');
    return;
  }
  await transport.send(userId, assessment);
}

export async function handleInvite(userId: UserId, transport: Transport): Promise<void> {
  const s = session.getSessionForParticipant(userId);
  if (!s) {
    await transport.send(userId, 'No active session.');
    return;
  }
  const link = transport.makeInviteLink(s.id, userId);
  await transport.send(userId, `Share this link — the first to join becomes player 2; everyone else watches as a spectator:\n${link}`);
}

export async function handleStatus(userId: UserId, transport: Transport): Promise<void> {
  const s = session.getSessionForParticipant(userId);
  if (!s) {
    await transport.send(userId, 'No active session.');
    return;
  }
  const isSpectator = s.spectators.includes(userId);
  const spectatorNames = s.spectators.map((id, i) => getName(id) ?? `spectator${i + 1}`);
  const spectatorLine = s.spectators.length === 0
    ? 'Spectators: none'
    : `Spectators: ${spectatorNames.join(', ')}`;

  if (s.user1 === null || s.user2 === null) {
    const presentPlayers = [s.user1, s.user2].filter((id): id is UserId => id !== null);
    const presentNames = presentPlayers.map(id => getName(id) ?? String(id));
    await transport.send(userId,
      `Session waiting for players.\nPresent: ${presentNames.join(', ')}\n${spectatorLine}\nUse /restart to begin a new game with available participants.`
    );
    return;
  }

  const name1 = getName(s.user1) ?? 'user1';
  const name2 = getName(s.user2) ?? 'user2';

  const interrogatorId = s.interrogator;
  const interrogatorName = interrogatorId === s.user1 ? name1 : name2;
  const interrogatorLabel = isSpectator ? interrogatorName : (interrogatorId === userId ? 'you' : interrogatorName);
  const interrogatorLine = `Interrogator: ${interrogatorLabel}`;

  let turnLine: string;
  if (isSpectator) {
    const witnessName = s.pendingResponder !== null ? (s.pendingResponder === s.user1 ? name1 : name2) : null;
    turnLine = witnessName !== null
      ? `Waiting for ${witnessName} to answer.`
      : `Waiting for ${interrogatorName} to ask a question.`;
  } else {
    const isInterrogator = userId === s.interrogator;
    if (s.pendingResponder !== null) {
      turnLine = isInterrogator ? 'Waiting for your partner to answer.' : 'Your turn to answer.';
    } else {
      turnLine = isInterrogator ? 'Your turn to ask a question.' : `Waiting for ${interrogatorName} to ask a question.`;
    }
  }

  const scoreLine = `Score — ${formatOriginalScores(s)}`;

  const playersLine = `Players: ${name1}, ${name2}`;

  await transport.send(userId, `${playersLine}\n${interrogatorLine}\n${turnLine}\n${scoreLine}\n${spectatorLine}`);
}

export async function handleRestart(
  userId: UserId,
  name1: string,
  name2: string,
  transport: Transport,
): Promise<void> {
  const s = session.getSessionForParticipant(userId);
  if (!s) {
    await transport.send(userId, 'No active session.');
    return;
  }
  if (!name1 || !name2) {
    await transport.send(userId, 'Usage: /restart <username1> <username2>');
    return;
  }

  const id1 = getUserIdByName(name1);
  const id2 = getUserIdByName(name2);
  if (!id1) { await transport.send(userId, `Unknown user: ${name1}`); return; }
  if (!id2) { await transport.send(userId, `Unknown user: ${name2}`); return; }
  if (id1 === id2) { await transport.send(userId, 'The two players must be different users.'); return; }

  const allParticipants = [s.user1, s.user2, ...s.spectators].filter((id): id is UserId => id !== null);
  if (!allParticipants.includes(id1)) { await transport.send(userId, `${name1} is not in this session.`); return; }
  if (!allParticipants.includes(id2)) { await transport.send(userId, `${name2} is not in this session.`); return; }

  session.restartWithPlayers(s, id1, id2);
  initGameCache(s as GameSession & { user1: UserId; user2: UserId });
  session.persistSessions();

  const msg1 = 'Game restarted! You are the interrogator — ask your first question.';
  const msg2 = 'Game restarted! Your partner is the interrogator. Wait for their first question.';

  await transport.send(s.user1!, msg1);
  await transport.send(s.user2!, msg2);
  await Promise.all(s.spectators.map(id => transport.send(id, 'Game restarted with new players.')));
}

export async function handleLeave(userId: UserId, transport: Transport): Promise<void> {
  const s = session.getSessionForParticipant(userId);
  if (!s) {
    await transport.send(userId, 'No active session.');
    return;
  }

  const name = getName(userId) ?? 'Someone';
  await transport.send(userId, 'You have left the session.');

  if (session.isPlayer(s, userId)) {
    const partner = session.getPartner(s, userId);
    const others = [partner, ...s.spectators].filter((id): id is UserId => id !== null);
    session.removePlayer(s, userId);
    await Promise.all(others.map(id => transport.send(id, `${name} left the session.`)));
  } else {
    session.removeSpectator(s, userId);
    const spectatorCount = s.spectators.length;
    await Promise.all([s.user1, s.user2].filter((id): id is UserId => id !== null).map(id =>
      transport.send(id, `${name} left. Spectators watching: ${spectatorCount}`)
    ));
  }

  if (s.user1 === null && s.user2 === null && s.spectators.length === 0) {
    logSession(s);
    session.endSession(s);
  }
}

export async function handleHuman(userId: UserId, guess: string, transport: Transport): Promise<void> {
  const s = session.getSessionForParticipant(userId);
  if (!s) {
    await transport.send(userId, 'No active session.');
    return;
  }
  if (!session.isPlayer(s, userId)) {
    await transport.send(userId, 'You are watching as a spectator.');
    return;
  }
  session.touchSession(s);
  touchUserSession(userId);
  if (!hasPlayers(s)) {
    await transport.send(userId, 'The other player has left. Use /restart to begin a new game with available participants.');
    return;
  }

  const hasExchange = s.transcript.some(e => e.role === 'model');
  if (userId !== s.interrogator || s.pendingResponder !== null || !hasExchange) {
    await transport.send(userId, 'It is not your turn to guess, or no exchange has happened yet.');
    return;
  }

  const g = guess.toUpperCase();
  if (g !== 'A' && g !== 'B') {
    await transport.send(userId, 'Usage: /human A  or  /human B');
    return;
  }

  const humanIsA = !s.imitationFirst;
  const correct = (g === 'A') === humanIsA;

  const role = userId === s.user1 ? 'user1' : 'user2';
  const partnerId = session.getPartner(s, userId)!;
  const partnerRole = partnerId === s.user1 ? 'user1' : 'user2';

  const reveal = s.imitationFirst
    ? 'A was the model, B was the human.'
    : 'A was the human, B was the model.';
  const guesserLabel = getName(userId)!;

  if (correct) {
    s.teamScores.humans += 1;
    s.winStreak = (s.winStreak ?? 0) + 1;
    if (s.winStreak > (s.longestWinStreak ?? 0)) s.longestWinStreak = s.winStreak;
  } else {
    s.teamScores.model += 1;
    s.winStreak = 0;
  }
  s.totalTurns += s.currentRoundTurns;
  s.roundCount += 1;
  const verdict = correct ? 'Correct! Humans point' : 'Wrong! Model point';
  const scoreStr = formatOriginalScoreStr(s);

  s.transcript.push({ role: 'guess', content: `${g} (${reveal})`, correct, guesser: role as 'user1' | 'user2' });
  saveState(s);

  const modelEntry = s.transcript[s.transcript.length - 2];
  const humanEntry = s.transcript[s.transcript.length - 3];
  if (modelEntry?.role === 'model' && humanEntry) {
    const imitateeId = humanEntry.role === 'user1' ? s.user1 : s.user2;
    const witnessRole = humanEntry.role as 'user1' | 'user2';
    const meta = { sessionId: s.id, guessNumber: s.transcript.filter(e => e.role === 'guess').length, guesserId: userId, imitateeId, correct };
    ensureGameCache(s);
    const { deltaMessages, deltaAssessments } = getDeltas(s);
    generateAssessment(s.transcript.slice(0, -3), humanEntry.content, modelEntry.content, correct, {
      user1: { id: s.user1, name: getName(s.user1) ?? 'user1' },
      user2: { id: s.user2, name: getName(s.user2) ?? 'user2' },
    }, witnessRole, s.cachedSystemPromptBlock!, deltaMessages, deltaAssessments, s.id).then(assessment => appendAssessment(assessment, meta)).catch(() => {});
  }

  await deliverRoundResultToSpectators(transport, s, guesserLabel, correct, reveal, scoreStr);
  session.reshuffle(s);

  const youAreNewInterrogator = s.interrogator === userId;
  await transport.send(
    userId,
    `${verdict} ${reveal}\n${scoreStr}\n\n` +
    (youAreNewInterrogator ? 'Your turn to interrogate. Ask your first question.' : 'Your partner is the interrogator now. Wait for their first question.'),
  );
  await transport.send(
    partnerId,
    `Your partner guessed ${correct ? 'correctly' : 'incorrectly'}. ${reveal}\n${scoreStr}\n\n` +
    (!youAreNewInterrogator ? 'Your turn to interrogate. Ask your first question.' : 'Your partner is the interrogator now. Wait for their first question.'),
  );
}

export async function handleMessage(userId: UserId, text: string, transport: Transport): Promise<void> {
  const s = session.getSessionForParticipant(userId);
  if (!s) {
    diagNoSession(userId, 'handleMessage');
    await transport.send(userId, 'Use /start to create an invite.');
    return;
  }
  if (!session.isPlayer(s, userId)) {
    await transport.send(userId, 'You are watching as a spectator.');
    return;
  }
  session.touchSession(s);
  touchUserSession(userId);
  if (!hasPlayers(s)) {
    await transport.send(userId, 'The other player has left. Use /restart to begin a new game with available participants.');
    return;
  }

  if (/^human[/\s]*(\w+\s+)*[ab]\b/i.test(text.trim()) || /^[ab]$/i.test(text.trim())) {
    await transport.send(userId, 'Looks like you meant to guess. Use /human A or /human B.');
    return;
  }

  const stripped = stripEmoji(text);
  if (!stripped) return;

  const witnessId = session.getPartner(s, s.interrogator)!;

  if (s.pendingResponder === witnessId) {
      if (userId !== witnessId) {
        await transport.send(userId, 'Waiting for your partner to respond. (You can still use /status, /invite, /leave.)');
        return;
      }
      const witnessFairnessCheck = await checkMessageFairness(stripped, s.id);
      if (!witnessFairnessCheck.fair) {
        await transport.send(userId,
          `That message can't be used — ${witnessFairnessCheck.reason} The AI has no way to imitate it. Please try a different answer.`);
        return;
      }
      const prediction = stripEmoji(s.pendingPrediction!);
      const witnessRole = witnessId === s.user1 ? 'user1' : 'user2';

      session.addToTranscript(s, witnessRole, stripped);
      session.addToTranscript(s, 'model', prediction);
      appendMessage(witnessId, s.interrogator, stripped);
      if (s.pendingSystemPrompt) s.lastSystemPrompt = s.pendingSystemPrompt;
      s.pendingPrediction = null;
      s.pendingSystemPrompt = null;
      s.pendingResponder = null;
      s.currentRoundTurns += 1;
      saveState(s);

      await transport.send(userId, `You: ${stripped}\nModel: ${prediction}`);
      await deliverToReceiver(transport, s.interrogator, { human: stripped, prediction }, s.imitationFirst);
      const witnessLabel = getName(witnessId)!;
      await deliverToSpectators(transport, s, witnessLabel, stripped, prediction);
      return;
    }

    if (userId !== s.interrogator) {
      await transport.send(userId, 'Waiting for your partner to ask a question. (You can still use /status, /invite, /leave.)');
      return;
    }
    const interrogatorFairnessCheck = await checkMessageFairness(stripped, s.id);
    if (!interrogatorFairnessCheck.fair) {
      await transport.send(userId,
        `That message can't be used — ${interrogatorFairnessCheck.reason} The AI has no way to answer it fairly. Please try a different question.`);
      return;
    }
    const witnessRole = witnessId === s.user1 ? 'user1' : 'user2';
    ensureGameCache(s);
    const { deltaMessages: wDeltaMessages, deltaAssessments: wDeltaAssessments } = getDeltas(s);
    const { text: predText, systemPrompt: sp } = await generatePrediction(
      s.transcript,
      witnessRole,
      {
        user1: { id: s.user1, name: getName(s.user1) ?? 'user1' },
        user2: { id: s.user2, name: getName(s.user2) ?? 'user2' },
      },
      s.cachedSystemPromptBlock!,
      wDeltaMessages,
      wDeltaAssessments,
      stripped,
      s.id,
    );
    const prediction = stripEmoji(predText);
    s.pendingPrediction = prediction;
    s.pendingSystemPrompt = sp;
    s.lastSystemPrompt = sp;
    s.pendingResponder = witnessId;

    const interrogatorRole = s.interrogator === s.user1 ? 'user1' : 'user2';
    session.addToTranscript(s, interrogatorRole, stripped);
    saveState(s);
    appendMessage(s.interrogator, witnessId, stripped);

    await transport.send(witnessId, stripped);

    if (s.spectators.length > 0) {
      const interrogatorLabel = getName(s.interrogator)!;
      const msg = `${interrogatorLabel} (interrogator): ${stripped}`;
      const failed: UserId[] = [];
      await Promise.all(s.spectators.map(async id => {
        try { await transport.send(id, msg); }
        catch { failed.push(id); }
      }));
      if (failed.length > 0) s.spectators = s.spectators.filter(id => !failed.includes(id));
    }
}
