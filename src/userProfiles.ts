import * as fs from 'fs';
import { UserId, UserProfile } from './types';
import { PROFILES_FILE as PROFILES_PATH } from './config';

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
    if (raw.users !== undefined) return raw as Store;
    const migrated = migrateFlat(raw);
    saveStore(migrated);
    return migrated;
  } catch { return { ...EMPTY_STORE, users: {}, pairs: {}, assessments: { list: [] } }; }
}

function saveStore(store: Store): void {
  const out = {
    counter: store.counter,
    nextId:  store.nextId,
    users: Object.fromEntries(
      Object.entries(store.users).sort(([a], [b]) => +a - +b)
    ),
    pairs: store.pairs,
    assessments: {
      list: [...store.assessments.list].sort((a, b) =>
        a.timestamp.localeCompare(b.timestamp)
      ),
    },
  };
  fs.writeFileSync(PROFILES_PATH, JSON.stringify(out, null, 2));
}

export function getProfile(userId: UserId, partnerId: UserId): UserProfile {
  return loadStore().pairs[`${userId}:${partnerId}`] ?? { messages: [] };
}

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,31}$/;

export function isValidName(name: string): boolean {
  return NAME_RE.test(name);
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
