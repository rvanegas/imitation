import { GameSession, UserId } from './types';
import { Transport } from './transport';
import * as session from './session';
import { generatePrediction, generateAssessment, buildCachedBlock, checkMessageFairness } from './imitation';
import {
  getProfile, appendMessage, getName, getOrAssignName, setName,
  isValidName, getUserIdByName, touchUserSession,
  recordRoundResult, getLeaderboard,
} from './userProfiles';
import {
  getGeneralAssessment, getUserAssessment, parseTaggedAssessment,
  appendAndSynthesizeGeneralAssessment, appendAndSynthesizeUserAssessment,
} from './assessments';
import { logSession, updateLog } from './log';
import { diagNoSession } from './diag';
import { buildScore, GameEvent, Label, LeaderboardEntry, Phase, Role, RosterEntry, SyncExchange } from './events';

function hasPlayers(s: GameSession): s is GameSession & { user1: UserId; user2: UserId } {
  return s.user1 !== null && s.user2 !== null;
}

// Called when a game becomes active (join or restart) to build the cached
// system-prompt blocks from current profiles. Profiles updated during the game
// take effect at the next game's rebuild.
function initGameCache(s: GameSession & { user1: UserId; user2: UserId }): void {
  s.cachedSystemPromptBlock = buildCachedBlock(
    {
      user1: { id: s.user1, name: getName(s.user1) ?? 'user1', messages: getProfile(s.user1, s.user2).messages },
      user2: { id: s.user2, name: getName(s.user2) ?? 'user2', messages: getProfile(s.user2, s.user1).messages },
    },
    getGeneralAssessment(),
    { user1: getUserAssessment(s.user1), user2: getUserAssessment(s.user2) },
  );
}

// Lazily rebuilds cachedSystemPromptBlock after a server restart.
function ensureGameCache(s: GameSession & { user1: UserId; user2: UserId }): void {
  if (s.cachedSystemPromptBlock) return;
  initGameCache(s);
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

// Derive a player's current role and phase from session state. The judge's
// "quiet" phase (pendingResponder === null) is either judge-ask at the top of a
// round or judge-decide once the witness has answered (last entry is the model's
// prediction, awaiting the call).
function roundPhase(s: GameSession, userId: UserId): { role: Role; phase: Phase } {
  const isJudge = userId === s.interrogator;
  const role: Role = isJudge ? 'judge' : 'witness';
  if (s.pendingResponder !== null) {
    return { role, phase: isJudge ? 'judge-wait' : 'witness-answer' };
  }
  const last = s.transcript[s.transcript.length - 1];
  if (last?.role === 'model') {
    return { role, phase: isJudge ? 'judge-decide' : 'witness-wait' };
  }
  return { role, phase: isJudge ? 'judge-ask' : 'witness-wait' };
}

// Present participants — seated players first, then spectators.
function buildRoster(s: GameSession): RosterEntry[] {
  const players = [s.user1, s.user2]
    .filter((id): id is UserId => id !== null)
    .map(id => ({ name: getName(id) ?? `user${id}`, seated: true }));
  const specs = s.spectators.map(id => ({ name: getName(id) ?? `user${id}`, seated: false }));
  return [...players, ...specs];
}

// The authoritative per-recipient snapshot, reconstructed purely from session
// state (the transcript is the source of truth). The app replaces its view with
// this, so replaying it any number of times converges to the same screen.
function buildSync(s: GameSession, userId: UserId): Extract<GameEvent, { kind: 'sync' }> {
  const waiting = s.user1 === null || s.user2 === null;
  const isPlayer = userId === s.user1 || userId === s.user2;
  const score = buildScore(s);
  const roster = buildRoster(s);
  const you = getName(userId) ?? 'you';

  // Lobby / spectator / a seat is empty → no live round to show.
  if (waiting || !isPlayer) {
    const partnerId = isPlayer ? (userId === s.user1 ? s.user2 : s.user1) : null;
    return {
      kind: 'sync', role: null, phase: 'lobby', score, you,
      partner: partnerId !== null ? (getName(partnerId) ?? 'partner') : '',
      exchanges: [], roster, waiting, reveal: null,
    };
  }

  const isJudge = userId === s.interrogator;
  const role: Role = isJudge ? 'judge' : 'witness';
  const partnerId = isJudge ? session.getPartner(s, userId)! : s.interrogator;
  const interrogatorRole: 'user1' | 'user2' = s.interrogator === s.user1 ? 'user1' : 'user2';
  const witnessRole: 'user1' | 'user2' = interrogatorRole === 'user1' ? 'user2' : 'user1';
  const myRole: 'user1' | 'user2' = userId === s.user1 ? 'user1' : 'user2';
  const base = { kind: 'sync' as const, role, score, you, partner: getName(partnerId) ?? 'partner', roster, waiting: false };

  const t = s.transcript;
  const last = t[t.length - 1];

  // Reveal: the round just ended — its result is the last entry (the guess).
  if (last?.role === 'guess') {
    const humanLabel: Label = last.humanLabel ?? 'A';
    const human = t[t.length - 3]?.content ?? '';
    const model = t[t.length - 2]?.content ?? '';
    return {
      ...base, phase: 'reveal', exchanges: [],
      reveal: {
        correct: last.correct ?? false,
        humanLabel,
        aText: humanLabel === 'A' ? human : model,
        bText: humanLabel === 'A' ? model : human,
        call: (last.content[0] as Label) ?? humanLabel,
        self: last.guesser === myRole,
        nextRole: role,
      },
    };
  }

  // In-progress round: rebuild the Q&A thread from entries after the last guess.
  let start = 0;
  for (let i = t.length - 1; i >= 0; i--) { if (t[i].role === 'guess') { start = i + 1; break; } }
  const exchanges: SyncExchange[] = [];
  let pendingHuman: string | null = null;
  for (const e of t.slice(start)) {
    if (e.role === interrogatorRole) {
      exchanges.push({ question: e.content });
      pendingHuman = null;
    } else if (e.role === witnessRole) {
      pendingHuman = e.content;
    } else if (e.role === 'model') {
      const ex = exchanges[exchanges.length - 1];
      if (ex && pendingHuman !== null) {
        const humanIsA = !s.imitationFirst;
        ex.a = humanIsA ? pendingHuman : e.content;
        ex.b = humanIsA ? e.content : pendingHuman;
        if (role === 'witness') { ex.yourLabel = humanIsA ? 'A' : 'B'; ex.modelLabel = humanIsA ? 'B' : 'A'; }
        pendingHuman = null;
      }
    }
  }

  return { ...base, phase: roundPhase(s, userId).phase, exchanges, reveal: null };
}

// Send the authoritative snapshot to one recipient (text = Telegram fallback).
async function syncTo(transport: Transport, s: GameSession, userId: UserId, text = ''): Promise<void> {
  await transport.send(userId, text, buildSync(s, userId));
}

// Snapshot every participant (players + spectators), event-only.
async function syncAll(transport: Transport, s: GameSession): Promise<void> {
  const ids = [s.user1, s.user2, ...s.spectators].filter((id): id is UserId => id !== null);
  await Promise.all(ids.map(id => transport.send(id, '', buildSync(s, id))));
}

// Narrate to spectators: a text line for Telegram, the snapshot for the app.
// Drops spectators whose transport has gone away.
async function narrateSpectators(transport: Transport, s: GameSession, text: string): Promise<void> {
  if (s.spectators.length === 0) return;
  const failed: UserId[] = [];
  await Promise.all(s.spectators.map(async id => {
    try { await transport.send(id, text, buildSync(s, id)); }
    catch { failed.push(id); }
  }));
  if (failed.length > 0) s.spectators = s.spectators.filter(id => !failed.includes(id));
}

function leaderboardEntries(limit: number): LeaderboardEntry[] {
  return getLeaderboard(limit).map((e, i) => {
    const total = e.wins + e.losses;
    return {
      rank: i + 1,
      name: e.name,
      wins: e.wins,
      losses: e.losses,
      pct: total > 0 ? Math.round((e.wins / total) * 100) : 0,
      bestStreak: e.bestStreak,
    };
  });
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
  '/human A|B — Make your call on which message was written by the human\n' +
  '/invite — Get the session invite; first to join becomes player 2, others watch\n' +
  '/status — Show current turn, score, and spectator count\n' +
  '/reflection — Show the AI\'s assessment of the most recent call\n' +
  '/leave — Leave the current session\n' +
  '/restart <user1> <user2> — Restart the game with two players from the session\n' +
  '/setname <name> — Set your display name\n' +
  '/leaderboard — Show the top 10 players by wins\n' +
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
    { kind: 'invite', link },
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
    await transport.send(
      joined.user1!,
      'Game started! You are the judge — take the first turn.',
      buildSync(joined, joined.user1!),
    );
    await transport.send(
      joined.user2!,
      'Game started! Your partner is the judge. Wait for their first turn.',
      buildSync(joined, joined.user2!),
    );
    await Promise.all(joined.spectators.map(id => syncTo(transport, joined, id)));
    await Promise.all([joined.user1!, joined.user2!].map(id => handleLeaderboard(id, transport)));
    return;
  }

  const watched = session.addSpectator(sessionToken, userId);
  if (watched) {
    getOrAssignName(userId);
    touchUserSession(userId);
    const spectatorCount = watched.spectators.length;
    await transport.send(userId, HELP_TEXT);
    await transport.send(userId, 'You are now watching this game as a spectator.', buildSync(watched, userId));
    // Refresh everyone else's roster (so their restart picker sees the newcomer).
    const others = [watched.user1, watched.user2, ...watched.spectators]
      .filter((id): id is UserId => id !== null && id !== userId);
    const notice = `A spectator joined. Spectators watching: ${spectatorCount}`;
    await Promise.all(others.map(id => transport.send(id, notice, buildSync(watched, id))));
    return;
  }

  const isParticipant = !!session.getSessionForParticipant(userId);
  await transport.send(userId, isParticipant ? 'You are already in this session.' : 'Invalid or expired invite.');
}

export async function handleHelp(userId: UserId, transport: Transport): Promise<void> {
  await transport.send(userId, HELP_TEXT);
}

// Replay the reconnecting client's full state. Since the snapshot is rebuilt
// from the transcript, this is just "send the current truth" — no per-phase
// special-casing, and idempotent if it fires more than once.
export async function handleResync(userId: UserId, transport: Transport): Promise<void> {
  const s = session.getSessionForParticipant(userId);
  if (!s) return;  // not in a game — stay in the lobby
  await transport.send(userId, '', buildSync(s, userId));
}

export async function handleLeaderboard(userId: UserId, transport: Transport): Promise<void> {
  const entries = getLeaderboard(10);
  if (entries.length === 0) {
    await transport.send(userId, 'No leaderboard data yet — play some rounds first!');
    return;
  }
  const structured = leaderboardEntries(10);
  const lines: string[] = ['Leaderboard — Top players\n'];
  structured.forEach(e => {
    lines.push(`${e.rank}. ${e.name}  W:${e.wins} L:${e.losses} (${e.pct}%)  Streak: ${e.bestStreak}`);
  });
  await transport.send(userId, lines.join('\n'), { kind: 'leaderboard', entries: structured });
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
  const assessment = s.lastAssessment;
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
  await transport.send(
    userId,
    `Share this link — the first to join becomes player 2; everyone else watches as a spectator:\n${link}`,
    { kind: 'invite', link },
  );
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
      `Session waiting for players.\nPresent: ${presentNames.join(', ')}\n${spectatorLine}\nUse /restart to begin a new game with available participants.`,
      buildSync(s, userId),
    );
    return;
  }

  const name1 = getName(s.user1) ?? 'user1';
  const name2 = getName(s.user2) ?? 'user2';

  const judgeId = s.interrogator;
  const judgeName = judgeId === s.user1 ? name1 : name2;
  const judgeLabel = isSpectator ? judgeName : (judgeId === userId ? 'you' : judgeName);
  const judgeLine = `Judge: ${judgeLabel}`;

  let turnLine: string;
  if (isSpectator) {
    const witnessName = s.pendingResponder !== null ? (s.pendingResponder === s.user1 ? name1 : name2) : null;
    turnLine = witnessName !== null
      ? `Waiting for ${witnessName} to respond.`
      : `Waiting for ${judgeName} to take their turn.`;
  } else {
    const isJudge = userId === s.interrogator;
    if (s.pendingResponder !== null) {
      turnLine = isJudge ? 'Waiting for your partner to respond.' : 'Your turn to respond.';
    } else {
      turnLine = isJudge ? 'Your turn.' : `Waiting for ${judgeName} to take their turn.`;
    }
  }

  const scoreLine = `Score — ${formatOriginalScores(s)}`;

  const playersLine = `Players: ${name1}, ${name2}`;

  await transport.send(userId, `${playersLine}\n${judgeLine}\n${turnLine}\n${scoreLine}\n${spectatorLine}`, buildSync(s, userId));
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

  const msg1 = 'Game restarted! You are the judge — take the first turn.';
  const msg2 = 'Game restarted! Your partner is the judge. Wait for their first turn.';

  await transport.send(s.user1!, msg1, buildSync(s, s.user1!));
  await transport.send(s.user2!, msg2, buildSync(s, s.user2!));
  await Promise.all(s.spectators.map(id => transport.send(id, 'Game restarted with new players.', buildSync(s, id))));
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

export async function handleHuman(userId: UserId, call: string, transport: Transport): Promise<void> {
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
    await transport.send(userId, 'It is not your turn to call, or no exchange has happened yet.');
    return;
  }

  const g = call.toUpperCase();
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
  const callerLabel = getName(userId)!;

  if (correct) {
    s.teamScores.humans += 1;
    s.winStreak = (s.winStreak ?? 0) + 1;
    if (s.winStreak > (s.longestWinStreak ?? 0)) s.longestWinStreak = s.winStreak;
  } else {
    s.teamScores.model += 1;
    s.winStreak = 0;
  }
  const streakForStats = correct ? s.winStreak : 0;
  if (s.user1 !== null && s.user2 !== null) recordRoundResult(s.user1, s.user2, correct, streakForStats);
  s.totalTurns += s.currentRoundTurns;
  s.roundCount += 1;
  const verdict = correct ? 'Correct! Humans point' : 'Wrong! Model point';
  const scoreStr = formatOriginalScoreStr(s);

  s.transcript.push({ role: 'guess', content: `${g} (${reveal})`, correct, guesser: role as 'user1' | 'user2', humanLabel: humanIsA ? 'A' : 'B' }); // role literal 'guess' kept for data compatibility
  saveState(s);

  const modelEntry = s.transcript[s.transcript.length - 2];
  const humanEntry = s.transcript[s.transcript.length - 3];
  if (modelEntry?.role === 'model' && humanEntry) {
    const imitateeId = humanEntry.role === 'user1' ? s.user1 : s.user2;
    const witnessRole = humanEntry.role as 'user1' | 'user2';
    ensureGameCache(s);
    generateAssessment(s.transcript.slice(0, -3), humanEntry.content, modelEntry.content, correct, {
      user1: { id: s.user1, name: getName(s.user1) ?? 'user1' },
      user2: { id: s.user2, name: getName(s.user2) ?? 'user2' },
    }, witnessRole, s.cachedSystemPromptBlock!, s.id).then(async assessment => {
      s.lastAssessment = assessment;
      saveState(s);
      const { general, userSpecific } = parseTaggedAssessment(assessment);
      if (general) await appendAndSynthesizeGeneralAssessment(general, s.id);
      if (userSpecific) await appendAndSynthesizeUserAssessment(imitateeId, userSpecific, s.id);
    }).catch(() => {});
  }

  session.reshuffle(s);
  await narrateSpectators(transport, s,
    `${callerLabel} called ${correct ? 'correctly' : 'incorrectly'}. ${reveal}\nScore — ${scoreStr}`);

  // The snapshot reads the round result off the stored guess entry, so both the
  // verdict view and each recipient's next role come straight from state.
  const youAreNewJudge = s.interrogator === userId;
  await transport.send(
    userId,
    `${verdict} ${reveal}\n${scoreStr}\n\n` +
    (youAreNewJudge ? 'You are the judge — take the first turn.' : 'Your partner is the judge now. Wait for their first turn.'),
    buildSync(s, userId),
  );
  await transport.send(
    partnerId,
    `Your partner called ${correct ? 'correctly' : 'incorrectly'}. ${reveal}\n${scoreStr}\n\n` +
    (!youAreNewJudge ? 'You are the judge — take the first turn.' : 'Your partner is the judge now. Wait for their first turn.'),
    buildSync(s, partnerId),
  );
  await Promise.all(s.spectators.map(id => syncTo(transport, s, id)));
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
    await transport.send(userId, 'Looks like you meant to make your call. Use /human A or /human B.');
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

      const myLabel: Label = s.imitationFirst ? 'B' : 'A';
      const modelLabel: Label = s.imitationFirst ? 'A' : 'B';
      const [msgA, msgB] = s.imitationFirst ? [prediction, stripped] : [stripped, prediction];
      await transport.send(
        userId,
        `You (${myLabel}): ${stripped}\nModel (${modelLabel}): ${prediction}`,
        buildSync(s, userId),
      );
      await transport.send(s.interrogator, `A: ${msgA}\nB: ${msgB}`, buildSync(s, s.interrogator));
      const witnessLabel = getName(witnessId)!;
      await narrateSpectators(transport, s, `${witnessLabel}: ${stripped}\n${witnessLabel} (imitation): ${prediction}`);
      return;
    }

    if (userId !== s.interrogator) {
      await transport.send(userId, 'Waiting for your partner to take their turn. (You can still use /status, /invite, /leave.)');
      return;
    }
    const judgeFairnessCheck = await checkMessageFairness(stripped, s.id);
    if (!judgeFairnessCheck.fair) {
      await transport.send(userId,
        `That message can't be used — ${judgeFairnessCheck.reason} The AI has no way to respond fairly. Please try something different.`);
      return;
    }
    const witnessRole = witnessId === s.user1 ? 'user1' : 'user2';
    ensureGameCache(s);
    const { text: predText, systemPrompt: sp } = await generatePrediction(
      s.transcript,
      witnessRole,
      {
        user1: { id: s.user1, name: getName(s.user1) ?? 'user1' },
        user2: { id: s.user2, name: getName(s.user2) ?? 'user2' },
      },
      s.cachedSystemPromptBlock!,
      stripped,
      s.id,
      s.imitationFirst,
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

    // Witness gets the question text + snapshot; judge's snapshot moves them to
    // the waiting state (event-only, so text clients stay silent).
    await transport.send(witnessId, stripped, buildSync(s, witnessId));
    await transport.send(s.interrogator, '', buildSync(s, s.interrogator));
    const judgeLabel = getName(s.interrogator)!;
    await narrateSpectators(transport, s, `${judgeLabel} (judge): ${stripped}`);
}
