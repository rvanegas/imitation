/**
 * Rebuilds each pair's leaderboard stats from the session logs. Until
 * 2026-11-20 appendMessage overwrote a pair's stats whenever the player with
 * the lower id sent a message, so what is stored counts only the calls since.
 * The logs record every call.
 *
 * Run once on the server with:  npx ts-node src/rebuildStats.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { PROFILES_FILE, STATE_DIR } from './config';
import { UserStats } from './types';
import { replacePairStats } from './userProfiles';

const CALL_RE = /^\[\S+ called: .* — (CORRECT|WRONG)\]$/gm;

// Totals the calls in each log by pair. A streak runs within one session, as
// the game counts it; logs without both players' ids hold no calls.
export function statsFromLogs(logs: string[]): Record<string, UserStats> {
  const stats: Record<string, UserStats> = {};
  for (const log of logs) {
    const u1 = log.match(/^User 1: (\d+)$/m)?.[1];
    const u2 = log.match(/^User 2: (\d+)$/m)?.[1];
    if (!u1 || !u2) continue;
    const key = `${Math.min(+u1, +u2)}:${Math.max(+u1, +u2)}`;
    const s = stats[key] ??= { wins: 0, losses: 0, bestStreak: 0 };
    let run = 0;
    for (const [, verdict] of log.matchAll(CALL_RE)) {
      if (verdict === 'CORRECT') { s.wins++; run++; s.bestStreak = Math.max(s.bestStreak, run); }
      else { s.losses++; run = 0; }
    }
    if (s.wins + s.losses === 0) delete stats[key];
  }
  return stats;
}

if (require.main === module) {
  const logDir = path.join(STATE_DIR, 'logs');
  const logs = fs.readdirSync(logDir)
    .filter(f => /^session-.*\.txt$/.test(f))
    .map(f => fs.readFileSync(path.join(logDir, f), 'utf8'));
  fs.copyFileSync(PROFILES_FILE, PROFILES_FILE + '.bak');
  const stats = statsFromLogs(logs);
  const replaced = replacePairStats(stats);
  for (const [key, s] of Object.entries(stats)) {
    const note = replaced.includes(key) ? '' : '  (skipped: a player no longer has a profile)';
    console.log(`${key}  W:${s.wins} L:${s.losses} streak ${s.bestStreak}${note}`);
  }
  console.log(`Backup at ${PROFILES_FILE}.bak`);
}
