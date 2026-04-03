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
