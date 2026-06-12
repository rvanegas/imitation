import * as fs from 'fs';
import { UserId, UserProfile, UserStats } from './types';
import { PROFILES_FILE as PROFILES_PATH } from './config';

const MAX_BYTES_PER_USER = 1 * 1024 * 1024; // 1 MB

// Legacy assessment essays. New lessons live in rolling profiles (see
// assessments.ts); this field is only preserved until the one-time migration
// archives and clears it.
interface AssessmentRecord {
  text: string;
  sessionId: string;
  guessNumber: number;
  imitateeId: UserId;  // the user being imitated (0 = general/compacted)
  correct: boolean;
  timestamp: string;
}

interface PairEntry {
  messages: string[];
  stats?: UserStats;
}

interface Store {
  users:       Record<string, UserProfile>;
  pairs:       Record<string, PairEntry>;
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
    store.assessments ??= { list: [] };
    store.assessments.list ??= [];
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
      .filter(r => !stale.has(r.imitateeId.toString()))
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
const RESERVED_NAME_RE = /^user[0-9]+$|^claude$/i;

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
  store.users[key] = { ...store.users[key], messages: store.users[key]?.messages ?? [], name, lastSession: new Date().toISOString() };
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

// --- WebSocket authentication ---

export function createAnonymousUser(): UserId {
  const store = loadStore();
  const id: UserId = store.nextId;
  store.nextId = id + 1;
  store.users[id.toString()] = { messages: [] };
  saveStore(store);
  return id;
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

export function recordRoundResult(user1: UserId, user2: UserId, won: boolean, currentStreak: number): void {
  const store = loadStore();
  const key = `${Math.min(user1, user2)}:${Math.max(user1, user2)}`;
  const prev: UserStats = store.pairs[key]?.stats ?? { wins: 0, losses: 0, bestStreak: 0 };
  store.pairs[key] = {
    ...(store.pairs[key] ?? { messages: [] }),
    stats: {
      wins:       prev.wins       + (won ? 1 : 0),
      losses:     prev.losses     + (won ? 0 : 1),
      bestStreak: Math.max(prev.bestStreak, won ? currentStreak : 0),
    },
  };
  saveStore(store);
}

export interface LeaderboardEntry {
  name: string;
  wins: number;
  losses: number;
  bestStreak: number;
}

export function getLeaderboard(limit = 10): LeaderboardEntry[] {
  const store = loadStore();
  const entries: LeaderboardEntry[] = [];

  for (const [key, pair] of Object.entries(store.pairs)) {
    const s = pair.stats;
    if (!s || s.wins + s.losses === 0) continue;
    const [id1, id2] = key.split(':').map(Number);
    const name1 = store.users[id1]?.name ?? store.users[id1.toString()]?.name ?? `user${id1}`;
    const name2 = store.users[id2]?.name ?? store.users[id2.toString()]?.name ?? `user${id2}`;
    entries.push({ name: `${name1} & ${name2}`, wins: s.wins, losses: s.losses, bestStreak: s.bestStreak });
  }

  // Sort: non-perfect by win% desc; perfect (100%) only rank above an entry if their wins > that entry's wins
  const perfect   = entries.filter(e => e.losses === 0).sort((a, b) => b.wins - a.wins);
  const imperfect = entries.filter(e => e.losses  > 0).sort((a, b) =>
    (b.wins / (b.wins + b.losses)) - (a.wins / (a.wins + a.losses))
  );

  const result: LeaderboardEntry[] = [];
  let pi = 0, ii = 0;
  while (pi < perfect.length || ii < imperfect.length) {
    const p = perfect[pi];
    const imp = imperfect[ii];
    if (!imp)              { result.push(p!);  pi++; }
    else if (!p)           { result.push(imp); ii++; }
    else if (p.wins > imp.wins) { result.push(p);   pi++; }
    else                   { result.push(imp); ii++; }
  }

  return result.slice(0, limit);
}
