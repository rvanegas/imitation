import * as fs from 'fs';
import * as crypto from 'crypto';
import { UserId, UserProfile } from './types';
import { PROFILES_FILE as PROFILES_PATH, WS_INVITES_FILE } from './config';

const MAX_BYTES_PER_USER = 1 * 1024 * 1024; // 1 MB

interface AssessmentRecord {
  text: string;
  sessionId: string;
  guessNumber: number;
  guesserId: UserId;
  imitateeId: UserId;  // the user being imitated (0 = general/compacted)
  correct: boolean;
  timestamp: string;
}

interface Store {
  users:       Record<string, UserProfile>;
  pairs:       Record<string, { messages: string[] }>;
  counter:     number;
  nextId:      number;
  assessments: { list: AssessmentRecord[] };
}

const EMPTY_STORE: Store = {
  counter: 0,
  nextId: 1,
  users: {},
  pairs: {},
  assessments: { list: [] },
};

function migrateFlat(old: Record<string, any>): Store {
  const users: Record<string, UserProfile> = {};
  const pairs: Record<string, { messages: string[] }> = {};
  for (const [k, v] of Object.entries(old)) {
    if (k === '__counter' || k === '__nextId' || k === '__assessments') continue;
    if (k.includes(':')) pairs[k] = v;
    else if (!k.startsWith('__')) users[k] = v;
  }
  return {
    counter:     old['__counter']     ?? 0,
    nextId:      old['__nextId']      ?? 1,
    users,
    pairs,
    assessments: old['__assessments'] ?? { list: [] },
  };
}

function loadStore(): Store {
  try {
    const raw = JSON.parse(fs.readFileSync(PROFILES_PATH, 'utf8'));
    if (raw.users === undefined) {
      const migrated = migrateFlat(raw);
      saveStore(migrated);
      return migrated;
    }
    const store = raw as Store;
    const before = store.assessments.list.length;
    store.assessments.list = store.assessments.list.filter(r => r.guesserId != null && r.imitateeId != null);
    if (store.assessments.list.length !== before) saveStore(store);
    return store;
  } catch { return { ...EMPTY_STORE, users: {}, pairs: {}, assessments: { list: [] } }; }
}

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function saveStore(store: Store): void {
  const now = Date.now();
  const stale = new Set<string>();
  for (const [key, profile] of Object.entries(store.users)) {
    if (profile.name && RESERVED_NAME_RE.test(profile.name)) {
      const last = profile.lastSession ? new Date(profile.lastSession).getTime() : 0;
      if (now - last > ONE_WEEK_MS) stale.add(key);
    }
  }
  const users = Object.fromEntries(
    Object.entries(store.users)
      .filter(([k]) => !stale.has(k))
      .sort(([a], [b]) => +a - +b)
  );
  const pairs = Object.fromEntries(
    Object.entries(store.pairs).filter(([k]) => {
      const [a, b] = k.split(':');
      return !stale.has(a) && !stale.has(b);
    })
  );
  const assessments = {
    list: store.assessments.list
      .filter(r => !stale.has(r.guesserId.toString()) && !stale.has(r.imitateeId.toString()))
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
  };
  const out = {
    counter: store.counter,
    nextId:  store.nextId,
    users,
    pairs,
    assessments,
  };
  fs.writeFileSync(PROFILES_PATH, JSON.stringify(out, null, 2));
}

export function getProfile(userId: UserId, partnerId: UserId): UserProfile {
  return loadStore().pairs[`${userId}:${partnerId}`] ?? { messages: [] };
}

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,31}$/;
const RESERVED_NAME_RE = /^user[0-9]+$/;

export function isValidName(name: string): boolean {
  return NAME_RE.test(name) && !RESERVED_NAME_RE.test(name);
}

export function getName(userId: UserId): string | undefined {
  return loadStore().users[userId.toString()]?.name;
}

export function getUserIdByName(name: string): UserId | undefined {
  const store = loadStore();
  for (const [key, profile] of Object.entries(store.users)) {
    if (profile.name?.toLowerCase() === name.toLowerCase()) {
      return parseInt(key, 10);
    }
  }
  return undefined;
}

export function getTelegramId(userId: UserId): number | undefined {
  return loadStore().users[userId.toString()]?.telegramId;
}

export function getUserIdByTelegramId(telegramId: number): UserId | undefined {
  const store = loadStore();
  for (const [key, profile] of Object.entries(store.users)) {
    if (profile.telegramId === telegramId) return parseInt(key, 10);
  }
  return undefined;
}

// Returns the server-assigned UserId for a Telegram user, creating one if needed.
export function getOrCreateUserIdForTelegram(telegramId: number): UserId {
  const existing = getUserIdByTelegramId(telegramId);
  if (existing !== undefined) return existing;
  const store = loadStore();
  const id: UserId = store.nextId;
  store.nextId = id + 1;
  store.users[id.toString()] = { messages: [], telegramId };
  saveStore(store);
  return id;
}

// Returns the server-assigned UserId for a named terminal user, creating one if needed.
export function getOrCreateUserIdByName(name: string): UserId {
  const existing = getUserIdByName(name);
  if (existing !== undefined) return existing;
  const store = loadStore();
  const id: UserId = store.nextId;
  store.nextId = id + 1;
  store.users[id.toString()] = { messages: [], name };
  saveStore(store);
  return id;
}

export function getOrAssignName(userId: UserId): string {
  const store = loadStore();
  const key = userId.toString();
  const existing = store.users[key]?.name;
  if (existing) return existing;
  const counter = store.counter + 1;
  store.counter = counter;
  const name = `user${counter}`;
  store.users[key] = { ...store.users[key], messages: store.users[key]?.messages ?? [], name };
  saveStore(store);
  return name;
}

export function touchUserSession(userId: UserId): void {
  const store = loadStore();
  const key = userId.toString();
  store.users[key] = { ...store.users[key], messages: store.users[key]?.messages ?? [], lastSession: new Date().toISOString() };
  saveStore(store);
}

export function setName(userId: UserId, name: string): void {
  const store = loadStore();
  const key = userId.toString();
  store.users[key] = { ...store.users[key], messages: store.users[key]?.messages ?? [], name };
  saveStore(store);
}

export function appendAssessment(
  assessment: string,
  meta: { sessionId: string; guessNumber: number; guesserId: UserId; imitateeId: UserId; correct: boolean }
): void {
  const store = loadStore();
  store.assessments.list.push({ text: assessment, timestamp: new Date().toISOString(), ...meta });
  saveStore(store);
}

// Returns all assessment texts (used by compact.ts).
export function getAllAssessments(): string[] {
  return loadStore().assessments.list.map(r => r.text);
}

// Returns assessments with imitatee metadata for labeled display in the system prompt.
export function getAssessmentsWithMeta(): Array<{ text: string; imitateeId: UserId }> {
  return loadStore().assessments.list.map(r => ({ text: r.text, imitateeId: r.imitateeId }));
}

export function setAssessments(list: string[]): void {
  const store = loadStore();
  // Compacted entries are general lessons (imitateeId=0).
  store.assessments.list = list.map(text => ({
    text,
    sessionId: '',
    guessNumber: 0,
    guesserId: 0,
    imitateeId: 0,
    correct: false,
    timestamp: new Date().toISOString(),
  }));
  saveStore(store);
}

// --- WebSocket authentication ---

function loadWsInvites(): string[] {
  try { return JSON.parse(fs.readFileSync(WS_INVITES_FILE, 'utf8')); } catch { return []; }
}

function saveWsInvites(tokens: string[]): void {
  fs.writeFileSync(WS_INVITES_FILE, JSON.stringify(tokens, null, 2));
}

export function createWsInviteToken(): string {
  const token = crypto.randomBytes(3).toString('hex'); // 6 hex chars, e.g. "a3f9c1"
  const tokens = loadWsInvites();
  tokens.push(token);
  saveWsInvites(tokens);
  return token;
}

export function consumeWsInviteToken(token: string): boolean {
  const tokens = loadWsInvites();
  const idx = tokens.indexOf(token);
  if (idx === -1) return false;
  tokens.splice(idx, 1);
  saveWsInvites(tokens);
  return true;
}

export function setWsToken(userId: UserId, token: string): void {
  const store = loadStore();
  const key = userId.toString();
  store.users[key] = { ...store.users[key], messages: store.users[key]?.messages ?? [], wsToken: token };
  saveStore(store);
}

export function getUserIdByWsToken(token: string): UserId | undefined {
  const store = loadStore();
  for (const [key, profile] of Object.entries(store.users)) {
    if (profile.wsToken === token) return parseInt(key, 10);
  }
  return undefined;
}

export function appendMessage(userId: UserId, partnerId: UserId, message: string): void {
  const store = loadStore();
  const key = `${userId}:${partnerId}`;
  const msgs = store.pairs[key]?.messages ?? [];
  if (msgs.includes(message)) return;
  msgs.push(message);
  while (msgs.reduce((n, m) => n + Buffer.byteLength(m, 'utf8'), 0) > MAX_BYTES_PER_USER) {
    msgs.shift();
  }
  store.pairs[key] = { messages: msgs };
  saveStore(store);
}
