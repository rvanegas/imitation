import { GameSession, SenderRole, UserId } from './types';

const pendingSessions = new Map<string, { userId: UserId; variation: 'symmetric' | 'original' }>();
const sessions = new Map<string, GameSession>();
const userToSession = new Map<UserId, string>();
// Maps a stable spectator token (prefixed "spec_") to a session id.
const spectatorTokens = new Map<string, string>();

const SESSION_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour

function generateToken(): string {
  return Math.random().toString(36).slice(2, 8);
}

export function createInvite(userId: UserId, variation: 'symmetric' | 'original'): string {
  const token = generateToken();
  pendingSessions.set(token, { userId, variation });
  return token;
}

export function acceptInvite(
  token: string,
  userId: UserId,
  onTimeout: (session: GameSession) => void
): GameSession | null {
  const entry = pendingSessions.get(token);
  if (entry === undefined) return null;

  pendingSessions.delete(token);
  const { userId: initiator, variation } = entry;

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
    spectators: [],
  };

  sessions.set(session.id, session);
  userToSession.set(initiator, session.id);
  userToSession.set(userId, session.id);

  return session;
}

export function createSpectatorInvite(session: GameSession): string {
  const token = `spec_${session.id}`;
  spectatorTokens.set(token, session.id);
  return token;
}

export function addSpectator(token: string, userId: UserId): GameSession | null {
  const sessionId = spectatorTokens.get(token);
  if (sessionId === undefined) return null;
  const session = sessions.get(sessionId);
  if (!session) return null;
  if (!session.spectators.includes(userId)) {
    session.spectators.push(userId);
  }
  return session;
}

export function getSessionForUser(userId: UserId): GameSession | undefined {
  const sessionId = userToSession.get(userId);
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
  } else {
    session.firstSender = session.firstSender === session.user1 ? session.user2 : session.user1;
    session.pendingResponder = session.firstSender;
  }
}

export function endSession(session: GameSession): void {
  clearTimeout(session.timeoutHandle);
  userToSession.delete(session.user1);
  userToSession.delete(session.user2);
  sessions.delete(session.id);
  spectatorTokens.delete(`spec_${session.id}`);
}
