import { GameSession, SenderRole, UserId } from './types';

const pendingSessions = new Map<string, { userId: UserId; variation: 'symmetric' | 'original' }>();
const sessions = new Map<string, GameSession>();
const userToSession = new Map<UserId, string>();
const spectatorToSession = new Map<UserId, string>();

const SESSION_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour

function generateToken(): string {
  return Math.random().toString(36).slice(2, 8);
}

export function createInvite(userId: UserId, variation: 'symmetric' | 'original'): string {
  const token = generateToken();
  pendingSessions.set(token, { userId, variation });
  return token;
}

export function isOwnInvite(token: string, userId: UserId): boolean {
  const entry = pendingSessions.get(token);
  return entry !== undefined && entry.userId === userId;
}

export function acceptInvite(
  token: string,
  userId: UserId,
  onTimeout: (session: GameSession) => void
): GameSession | null {
  const entry = pendingSessions.get(token);
  if (entry === undefined) return null;

  const { userId: initiator, variation } = entry;
  if (userId === initiator) return null;

  pendingSessions.delete(token);

  const session: GameSession = {
    id: token,
    user1: initiator,
    user2: userId,
    status: 'active',
    variation,
    imitationFirst: Math.random() < 0.5,
    timeoutHandle: setTimeout(() => onTimeout(session), SESSION_TIMEOUT_MS),
    transcript: [],
    pendingResponder: variation === 'original' ? null : initiator,
    firstSender: initiator,
    interrogator: initiator,
    pendingPrediction: null,
    scores: { user1: 0, user2: 0 },
    teamScores: { humans: 0, model: 0 },
    currentRoundTurns: 0,
    totalTurns: 0,
    roundCount: 0,
    spectators: [],
  };

  sessions.set(session.id, session);
  userToSession.set(initiator, session.id);
  userToSession.set(userId, session.id);

  return session;
}

export function addSpectator(sessionId: string, userId: UserId): GameSession | null {
  const session = sessions.get(sessionId);
  if (!session) return null;
  if (userId === session.user1 || userId === session.user2) return null;
  if (!session.spectators.includes(userId)) {
    session.spectators.push(userId);
    spectatorToSession.set(userId, session.id);
  }
  return session;
}

export function getSessionForUser(userId: UserId): GameSession | undefined {
  const sessionId = userToSession.get(userId);
  if (sessionId === undefined) return undefined;
  return sessions.get(sessionId);
}

export function getSessionForSpectator(userId: UserId): GameSession | undefined {
  const sessionId = spectatorToSession.get(userId);
  if (sessionId === undefined) return undefined;
  return sessions.get(sessionId);
}

export function getPartner(session: GameSession, userId: UserId): UserId {
  return userId === session.user1 ? session.user2 : session.user1;
}

export function addToTranscript(session: GameSession, role: SenderRole, content: string): void {
  session.transcript.push({ role, content });
}

export function touchSession(session: GameSession, onTimeout: (session: GameSession) => void): void {
  clearTimeout(session.timeoutHandle);
  session.timeoutHandle = setTimeout(() => onTimeout(session), SESSION_TIMEOUT_MS);
}

export function reshuffle(session: GameSession): void {
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
}

export function restartWithPlayers(
  s: GameSession,
  newUser1: UserId,
  newUser2: UserId,
  onTimeout: (session: GameSession) => void
): void {
  userToSession.delete(s.user1);
  userToSession.delete(s.user2);
  userToSession.set(newUser1, s.id);
  userToSession.set(newUser2, s.id);

  const allPrev = [s.user1, s.user2, ...s.spectators];
  const newSpectators = allPrev.filter(id => id !== newUser1 && id !== newUser2);
  for (const id of s.spectators) spectatorToSession.delete(id);
  for (const id of newSpectators) spectatorToSession.set(id, s.id);

  s.user1 = newUser1;
  s.user2 = newUser2;
  s.spectators = newSpectators;
  s.imitationFirst = Math.random() < 0.5;
  s.transcript = [];
  s.pendingResponder = s.variation === 'original' ? null : newUser1;
  s.firstSender = newUser1;
  s.interrogator = newUser1;
  s.pendingPrediction = null;
  s.scores = { user1: 0, user2: 0 };
  s.teamScores = { humans: 0, model: 0 };
  s.currentRoundTurns = 0;
  s.totalTurns = 0;
  s.roundCount = 0;

  clearTimeout(s.timeoutHandle);
  s.timeoutHandle = setTimeout(() => onTimeout(s), SESSION_TIMEOUT_MS);
}

export function endSession(session: GameSession): void {
  clearTimeout(session.timeoutHandle);
  userToSession.delete(session.user1);
  userToSession.delete(session.user2);
  for (const id of session.spectators) spectatorToSession.delete(id);
  sessions.delete(session.id);
}
