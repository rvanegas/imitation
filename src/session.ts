import { GameSession, SenderRole, UserId } from './types';

const pendingSessions = new Map<string, UserId>();
const sessions = new Map<string, GameSession>();
const userToSession = new Map<UserId, string>();

const SESSION_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour

function generateToken(): string {
  return Math.random().toString(36).slice(2, 8);
}

export function createInvite(userId: UserId): string {
  const token = generateToken();
  pendingSessions.set(token, userId);
  return token;
}

export function acceptInvite(
  token: string,
  userId: UserId,
  onTimeout: (session: GameSession) => void
): GameSession | null {
  const initiator = pendingSessions.get(token);
  if (initiator === undefined) return null;

  pendingSessions.delete(token);

  const session: GameSession = {
    id: token,
    user1: initiator,
    user2: userId,
    status: 'active',
    imitationFirst: Math.random() < 0.5,
    timeoutHandle: setTimeout(() => onTimeout(session), SESSION_TIMEOUT_MS),
    transcript: [],
    pendingResponder: initiator,
    firstSender: initiator,
    scores: { user1: 0, user2: 0 },
  };

  sessions.set(session.id, session);
  userToSession.set(initiator, session.id);
  userToSession.set(userId, session.id);

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
  session.firstSender = session.firstSender === session.user1 ? session.user2 : session.user1;
  session.pendingResponder = session.firstSender;
}

export function endSession(session: GameSession): void {
  clearTimeout(session.timeoutHandle);
  userToSession.delete(session.user1);
  userToSession.delete(session.user2);
  sessions.delete(session.id);
}
