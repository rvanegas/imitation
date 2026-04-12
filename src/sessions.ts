import * as fs from 'fs';
import { SESSIONS_FILE, PROFILES_FILE } from './config';

export function showSessions(): void {
  let sessions: Record<string, any> = {};
  let users: Record<string, any> = {};

  try {
    sessions = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8')).sessions ?? {};
  } catch {
    console.log('No sessions file found.');
    return;
  }

  try {
    users = JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf8')).users ?? {};
  } catch {}

  function name(id: number | null): string {
    if (id === null) return '—';
    return users[String(id)]?.name ?? `user${id}`;
  }

  const entries = Object.entries(sessions);
  if (entries.length === 0) {
    console.log('No active sessions.');
    return;
  }

  console.log(`Sessions: ${entries.length}`);
  for (const [token, s] of entries) {
    const players = s.user2 != null
      ? `${name(s.user1)} vs ${name(s.user2)}`
      : `${name(s.user1)} (waiting)`;
    const spectators = (s.spectators ?? []).length > 0
      ? `  spectators: ${(s.spectators as number[]).map(id => name(id)).join(', ')}`
      : '';
    const age = s.lastActivity
      ? `  last active ${Math.round((Date.now() - s.lastActivity) / 60000)}m ago`
      : '';
    console.log(`  ${token}  ${players}  [${s.variation}]${spectators}${age}`);
  }
}
