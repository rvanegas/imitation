import * as fs from 'fs';
import { GameSession, SenderRole, UserId } from './types';
import { diagSessionCreated, diagSessionEnded, diagSessionsLoaded, diagUserMapped, diagUserUnmapped } from './diag';
import { SESSIONS_FILE } from './config';

const sessions = new Map<string, GameSession>();
const participantToSession = new Map<UserId, string>();

const SESSION_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour

let timeoutCallback: ((s: GameSession) => Promise<void>) | null = null;

export function setTimeoutCallback(fn: (s: GameSession) => Promise<void>): void {
  timeoutCallback = fn;
}

function scheduleTimeout(s: GameSession): void {
  const elapsed = Date.now() - (s.lastActivity ?? 0);
  const remaining = Math.max(SESSION_TIMEOUT_MS - elapsed, 0);
  s.timeoutHandle = setTimeout(async () => {
    const idle = Date.now() - (s.lastActivity ?? 0);
    if (idle >= SESSION_TIMEOUT_MS) {
      diagSessionEnded(s.id, 'timeout');
      await timeoutCallback!(s);
    } else {
      scheduleTimeout(s);
    }
  }, remaining);
}

function generateSessionToken(): string {
  return Math.random().toString(36).slice(2, 8);
}

export function persistSessions(): void {
  const data = {
    sessions: Object.fromEntries(
      [...sessions.entries()].map(([id, s]) => {
        const { timeoutHandle, lastSystemPrompt, pendingSystemPrompt, cachedSystemPromptBlock, ...rest } = s;
        return [id, rest];
      })
    ),
  };
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(data, null, 2));
}

export function loadPersistedSessions(): void {
  let data: any;
  try {
    data = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
  } catch {
    return;
  }

  let loadedCount = 0;
  for (const [id, persisted] of Object.entries<any>(data.sessions ?? {})) {
    const elapsed = Date.now() - (persisted.lastActivity ?? 0);
    if (elapsed >= SESSION_TIMEOUT_MS) continue;
    loadedCount++;
    const s: GameSession = { ...persisted, timeoutHandle: null as any };
    scheduleTimeout(s);
    sessions.set(id, s);
    if (s.user1 != null) { participantToSession.set(s.user1, id); diagUserMapped(s.user1, id); }
    if (s.user2 != null) { participantToSession.set(s.user2, id); diagUserMapped(s.user2, id); }
    for (const spectatorId of s.spectators ?? []) {
      participantToSession.set(spectatorId, id);
    }
  }
  diagSessionsLoaded(loadedCount);
}

export function createInvite(userId: UserId, variation: 'symmetric' | 'original'): string {
  const sessionToken = generateSessionToken();
  const s: GameSession = {
    id: sessionToken,
    user1: userId,
    user2: null,
    status: 'active',
    variation,
    imitationFirst: false,
    timeoutHandle: null as any,
    transcript: [],
    pendingResponder: variation === 'original' ? null : userId,
    firstSender: userId,
    interrogator: userId,
    pendingPrediction: null,
    pendingSystemPrompt: null,
    scores: { user1: 0, user2: 0 },
    teamScores: { humans: 0, model: 0 },
    currentRoundTurns: 0,
    totalTurns: 0,
    roundCount: 0,
    spectators: [],
    lastActivity: Date.now(),
  };
  scheduleTimeout(s);
  sessions.set(s.id, s);
  participantToSession.set(userId, sessionToken);
  diagUserMapped(userId, sessionToken);
  persistSessions();
  return sessionToken;
}

export function isValidSessionToken(token: string): boolean {
  return sessions.has(token);
}

export function isOwnInvite(token: string, userId: UserId): boolean {
  return sessions.get(token)?.user1 === userId;
}

export function acceptInvite(token: string, userId: UserId): GameSession | null {
  const s = sessions.get(token);
  if (s === undefined || s.user2 !== null) return null;
  if (s.user1 === userId) return null;

  s.user2 = userId;
  s.imitationFirst = Math.random() < 0.5;
  participantToSession.set(userId, token);
  diagSessionCreated(s.id, s.user1!, userId);
  diagUserMapped(userId, s.id);

  persistSessions();
  return s;
}

export function addSpectator(sessionId: string, userId: UserId): GameSession | null {
  const session = sessions.get(sessionId);
  if (!session) return null;
  if (userId === session.user1 || userId === session.user2) return null;
  if (!session.spectators.includes(userId)) {
    session.spectators.push(userId);
    participantToSession.set(userId, session.id);
  }
  persistSessions();
  return session;
}

export function getSessionForParticipant(userId: UserId): GameSession | undefined {
  const sessionId = participantToSession.get(userId);
  if (sessionId === undefined) return undefined;
  return sessions.get(sessionId);
}

export function isPlayer(session: GameSession, userId: UserId): boolean {
  return session.user1 === userId || session.user2 === userId;
}

export function getPartner(session: GameSession, userId: UserId): UserId | null {
  return userId === session.user1 ? session.user2 : session.user1;
}

export function addToTranscript(session: GameSession, role: SenderRole, content: string): void {
  session.transcript.push({ role, content });
}

export function touchSession(s: GameSession): void {
  s.lastActivity = Date.now();
  persistSessions();
}

export function reshuffle(session: GameSession): void {
  if (session.user1 === null || session.user2 === null) return;
  session.imitationFirst = Math.random() < 0.5;
  if (session.variation === 'original') {
    session.interrogator = session.interrogator === session.user1 ? session.user2 : session.user1;
    session.pendingResponder = null;
    session.pendingPrediction = null;
    session.currentRoundTurns = 0;
  } else {
    session.firstSender = session.firstSender === session.user1 ? session.user2 : session.user1;
    session.pendingResponder = session.firstSender;
  }
  persistSessions();
}

export function restartWithPlayers(
  s: GameSession,
  newUser1: UserId,
  newUser2: UserId,
): void {
  const allPrev = [s.user1, s.user2, ...s.spectators].filter((id): id is UserId => id !== null);
  const newSpectators = allPrev.filter(id => id !== newUser1 && id !== newUser2);

  for (const id of allPrev) participantToSession.delete(id);
  participantToSession.set(newUser1, s.id);
  participantToSession.set(newUser2, s.id);
  for (const id of newSpectators) participantToSession.set(id, s.id);

  s.user1 = newUser1;
  s.user2 = newUser2;
  s.spectators = newSpectators;
  s.imitationFirst = Math.random() < 0.5;
  s.transcript = [];
  s.pendingResponder = s.variation === 'original' ? null : newUser1;
  s.firstSender = newUser1;
  s.interrogator = newUser1;
  s.pendingPrediction = null;
  s.pendingSystemPrompt = null;
  s.scores = { user1: 0, user2: 0 };
  s.teamScores = { humans: 0, model: 0 };
  s.currentRoundTurns = 0;
  s.totalTurns = 0;
  s.roundCount = 0;
  s.lastActivity = Date.now();

  clearTimeout(s.timeoutHandle);
  scheduleTimeout(s);

  persistSessions();
}

export function removePlayer(s: GameSession, userId: UserId): void {
  diagUserUnmapped(userId, s.id);
  participantToSession.delete(userId);
  if (s.user1 === userId) s.user1 = null;
  else if (s.user2 === userId) s.user2 = null;
  persistSessions();
}

export function removeSpectator(s: GameSession, userId: UserId): void {
  participantToSession.delete(userId);
  s.spectators = s.spectators.filter(id => id !== userId);
  persistSessions();
}

export function endSession(session: GameSession): void {
  clearTimeout(session.timeoutHandle);
  diagSessionEnded(session.id, 'explicit');
  if (session.user1 != null) { participantToSession.delete(session.user1); diagUserUnmapped(session.user1, session.id); }
  if (session.user2 != null) { participantToSession.delete(session.user2); diagUserUnmapped(session.user2, session.id); }
  for (const id of session.spectators) participantToSession.delete(id);
  sessions.delete(session.id);
  persistSessions();
}
