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

export function appendAssessment(assessment: string): void {
  const store = loadStore();
  const list: string[] = (store as Record<string, any>)['__assessments']?.list ?? [];
  list.push(assessment);
  (store as Record<string, any>)['__assessments'] = { list };
  saveStore(store);
}

export function getAssessments(): string[] {
  return (loadStore() as Record<string, any>)['__assessments']?.list ?? [];
}

export function setAssessments(list: string[]): void {
  const store = loadStore();
  (store as Record<string, any>)['__assessments'] = { list };
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
