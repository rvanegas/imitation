/**
 * One-time migration: convert user_profiles.json and sessions.json from
 * Telegram-ID-keyed format to server-assigned sequential IDs with an optional
 * telegramId field on each user profile.
 *
 * Run once with:  npx ts-node src/migrate.ts
 */

import * as fs from 'fs';
import { PROFILES_FILE as PROFILES_PATH, SESSIONS_FILE as SESSIONS_PATH } from './config';

// IDs below this threshold are treated as server-assigned sequential IDs.
// Telegram user IDs are always well above 1 000 000.
const THRESHOLD = 1_000_000;

function migrate(): void {
  // ── Load ─────────────────────────────────────────────────────────────────
  const profilesRaw = fs.readFileSync(PROFILES_PATH, 'utf8');
  const profiles = JSON.parse(profilesRaw) as Record<string, any>;

  let sessionsRaw: string | null = null;
  let sessions: Record<string, any> | null = null;
  if (fs.existsSync(SESSIONS_PATH)) {
    sessionsRaw = fs.readFileSync(SESSIONS_PATH, 'utf8');
    sessions = JSON.parse(sessionsRaw);
  }

  // ── Backup ───────────────────────────────────────────────────────────────
  fs.writeFileSync(PROFILES_PATH + '.bak', profilesRaw);
  if (sessionsRaw) fs.writeFileSync(SESSIONS_PATH + '.bak', sessionsRaw);
  console.log('Backups written (.bak).');

  // ── Separate entries ─────────────────────────────────────────────────────
  const smallUsers = new Map<number, any>(); // terminal (server-assigned)
  const largeUsers = new Map<number, any>(); // Telegram

  for (const [key, value] of Object.entries(profiles)) {
    if (key.startsWith('__') || key.includes(':')) continue;
    const id = parseInt(key, 10);
    if (isNaN(id)) continue;
    if (id < THRESHOLD) smallUsers.set(id, value);
    else largeUsers.set(id, value);
  }

  // ── Build ID mapping ─────────────────────────────────────────────────────
  const idMap = new Map<number, number>(); // oldId → newId

  for (const id of smallUsers.keys()) idMap.set(id, id);

  let nextId = smallUsers.size > 0 ? Math.max(...smallUsers.keys()) + 1 : 1;

  // name → small ID, for detecting same-person duplicates
  const nameToSmallId = new Map<string, number>();
  for (const [id, profile] of smallUsers) {
    if (profile.name) nameToSmallId.set(profile.name, id);
  }

  for (const [id, profile] of largeUsers) {
    const merge = profile.name ? nameToSmallId.get(profile.name) : undefined;
    if (merge !== undefined) {
      idMap.set(id, merge);
      console.log(`Merge : ${id} (${profile.name}) → ${merge}`);
    } else {
      idMap.set(id, nextId);
      console.log(`Remap : ${id} (${profile.name ?? '(unnamed)'}) → ${nextId}`);
      nextId++;
    }
  }

  // ── Build new profile store ───────────────────────────────────────────────
  const users: Record<string, any> = {};
  const pairs: Record<string, any> = {};

  // Terminal user entries (keep as-is)
  for (const [id, profile] of smallUsers) {
    users[id.toString()] = { ...profile };
  }

  // Telegram user entries (rekeyed, telegramId added)
  for (const [oldId, profile] of largeUsers) {
    const newId = idMap.get(oldId)!;
    if (users[newId.toString()]) {
      // Merging into an existing small-ID entry
      users[newId.toString()] = { ...users[newId.toString()], telegramId: oldId };
    } else {
      users[newId.toString()] = { ...profile, telegramId: oldId };
    }
  }

  // Pair message entries (rekeyed; merge messages on collision)
  for (const [key, value] of Object.entries(profiles)) {
    if (!key.includes(':')) continue;
    const [rawA, rawB] = key.split(':');
    const a = parseInt(rawA, 10);
    const b = parseInt(rawB, 10);
    if (isNaN(a) || isNaN(b)) continue;
    const newKey = `${idMap.get(a) ?? a}:${idMap.get(b) ?? b}`;
    if (pairs[newKey]) {
      const existing: string[] = pairs[newKey].messages ?? [];
      const incoming: string[] = value.messages ?? [];
      const merged = Array.from(new Set([...existing, ...incoming]));
      pairs[newKey] = { messages: merged };
      console.log(`Merged pair ${key} → ${newKey} (${merged.length} msgs)`);
    } else {
      pairs[newKey] = { ...value };
    }
  }

  // Assessments: remap guesserId / imitateeId
  const assessmentList = (profiles['__assessments']?.list ?? profiles.assessments?.list ?? []).map((a: any) => ({
    ...a,
    guesserId: idMap.get(a.guesserId) ?? a.guesserId,
    imitateeId: idMap.get(a.imitateeId) ?? a.imitateeId,
  }));

  const counter = profiles['__counter'] ?? profiles.counter ?? 0;

  // Write new nested format; sort user ids numerically, assessments by timestamp
  const out = {
    counter,
    nextId,
    users: Object.fromEntries(
      Object.entries(users).sort(([a], [b]) => +a - +b)
    ),
    pairs,
    assessments: {
      list: assessmentList.sort((a: any, b: any) => a.timestamp.localeCompare(b.timestamp)),
    },
  };

  fs.writeFileSync(PROFILES_PATH, JSON.stringify(out, null, 2));
  console.log(`\nuser_profiles.json written. nextId = ${nextId}`);

  // ── Migrate sessions.json ─────────────────────────────────────────────────
  if (sessions) {
    function remap(id: any): any {
      return typeof id === 'number' ? (idMap.get(id) ?? id) : id;
    }

    const newSessions: Record<string, any> = {};
    for (const [id, s] of Object.entries<any>(sessions.sessions ?? {})) {
      newSessions[id] = {
        ...s,
        user1: remap(s.user1),
        user2: remap(s.user2),
        spectators: (s.spectators ?? []).map(remap),
        pendingResponder: s.pendingResponder !== null ? remap(s.pendingResponder) : null,
        firstSender: remap(s.firstSender),
        interrogator: remap(s.interrogator),
      };
    }

    const newPending: Record<string, any> = {};
    for (const [token, entry] of Object.entries<any>(sessions.pendingSessions ?? {})) {
      newPending[token] = { ...entry, userId: remap(entry.userId) };
    }

    fs.writeFileSync(SESSIONS_PATH, JSON.stringify({ sessions: newSessions, pendingSessions: newPending }, null, 2));
    console.log('sessions.json written.');
  }

  console.log('\nID mapping (changed only):');
  for (const [oldId, newId] of idMap) {
    if (oldId !== newId) console.log(`  ${oldId} → ${newId}`);
  }
  console.log('\nDone. Backups are at *.bak if you need to roll back.');
}

migrate();
