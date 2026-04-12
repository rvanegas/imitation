import { UserId } from './types';

const linkTokens = new Map<string, { userId: UserId; expiresAt: number }>();
const TTL_MS = 10 * 60 * 1000;

// Alphabet excludes O, 0, I, 1 to avoid visual confusion.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, b => ALPHABET[b % ALPHABET.length]).join('');
}

export function createLinkToken(userId: UserId): string {
  const now = Date.now();
  // Lazy-purge expired entries.
  for (const [token, entry] of linkTokens) {
    if (entry.expiresAt <= now) linkTokens.delete(token);
  }
  // Revoke any prior token for this user.
  for (const [token, entry] of linkTokens) {
    if (entry.userId === userId) linkTokens.delete(token);
  }
  const token = generateToken();
  linkTokens.set(token, { userId, expiresAt: now + TTL_MS });
  return token;
}

export function consumeLinkToken(token: string): UserId | undefined {
  const entry = linkTokens.get(token);
  if (!entry || entry.expiresAt <= Date.now()) return undefined;
  linkTokens.delete(token);
  return entry.userId;
}
