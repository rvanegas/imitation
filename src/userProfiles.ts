import * as fs from 'fs';
import * as path from 'path';
import { UserId, UserProfile, UserProfileStore } from './types';

const PROFILES_PATH = path.resolve(__dirname, '../user_profiles.json');
const MAX_BYTES_PER_USER = 1 * 1024 * 1024; // 1 MB

function loadStore(): UserProfileStore {
  try { return JSON.parse(fs.readFileSync(PROFILES_PATH, 'utf8')); }
  catch { return {}; }
}

function saveStore(store: UserProfileStore): void {
  fs.writeFileSync(PROFILES_PATH, JSON.stringify(store, null, 2));
}

export function getProfile(userId: UserId, partnerId: UserId): UserProfile {
  return loadStore()[`${userId}:${partnerId}`] ?? { messages: [] };
}

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,31}$/;

export function isValidName(name: string): boolean {
  return NAME_RE.test(name);
}

export function getName(userId: UserId): string | undefined {
  return loadStore()[userId.toString()]?.name;
}

export function getUserIdByName(name: string): UserId | undefined {
  const store = loadStore();
  for (const [key, profile] of Object.entries(store)) {
    if (!key.includes(':') && profile.name === name) {
      return parseInt(key, 10);
    }
  }
  return undefined;
}

export function getOrAssignName(userId: UserId): string {
  const store = loadStore();
  const key = userId.toString();
  const existing = store[key]?.name;
  if (existing) return existing;
  const counter = ((store as Record<string, any>)['__counter'] ?? 0) + 1;
  (store as Record<string, any>)['__counter'] = counter;
  const name = `user${counter}`;
  store[key] = { messages: store[key]?.messages ?? [], name };
  saveStore(store);
  return name;
}

export function setName(userId: UserId, name: string): void {
  const store = loadStore();
  const key = userId.toString();
  store[key] = { ...store[key], messages: store[key]?.messages ?? [], name };
  saveStore(store);
}

interface AssessmentRecord {
  text: string;
  sessionId: string;
  guessNumber: number;
  guesserId: UserId;
  imitateeId: UserId;  // the user being imitated (0 = general/compacted)
  correct: boolean;
  timestamp: string;
}

export function appendAssessment(
  assessment: string,
  meta: { sessionId: string; guessNumber: number; guesserId: UserId; imitateeId: UserId; correct: boolean }
): void {
  const store = loadStore();
  const list: AssessmentRecord[] = (store as Record<string, any>)['__assessments']?.list ?? [];
  list.push({ text: assessment, timestamp: new Date().toISOString(), ...meta });
  (store as Record<string, any>)['__assessments'] = { list };
  saveStore(store);
}

// Returns all assessment texts (used by compact.ts).
export function getAllAssessments(): string[] {
  const list: AssessmentRecord[] = (loadStore() as Record<string, any>)['__assessments']?.list ?? [];
  return list.map(r => r.text);
}

// Returns assessments with imitatee metadata for labeled display in the system prompt.
export function getAssessmentsWithMeta(): Array<{ text: string; imitateeId: UserId }> {
  const list: AssessmentRecord[] = (loadStore() as Record<string, any>)['__assessments']?.list ?? [];
  return list.map(r => ({ text: r.text, imitateeId: r.imitateeId }));
}

export function setAssessments(list: string[]): void {
  const store = loadStore();
  // Compacted entries are general lessons (imitateeId=0).
  const records: AssessmentRecord[] = list.map(text => ({
    text,
    sessionId: '',
    guessNumber: 0,
    guesserId: 0,
    imitateeId: 0,
    correct: false,
    timestamp: new Date().toISOString(),
  }));
  (store as Record<string, any>)['__assessments'] = { list: records };
  saveStore(store);
}

export function appendMessage(userId: UserId, partnerId: UserId, message: string): void {
  const store = loadStore();
  const key = `${userId}:${partnerId}`;
  const msgs = store[key]?.messages ?? [];
  if (msgs.includes(message)) return;
  msgs.push(message);
  while (msgs.reduce((n, m) => n + Buffer.byteLength(m, 'utf8'), 0) > MAX_BYTES_PER_USER) {
    msgs.shift();
  }
  store[key] = { messages: msgs };
  saveStore(store);
}
