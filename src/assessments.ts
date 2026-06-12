import * as fs from 'fs';
import * as path from 'path';
import { UserId } from './types';
import { STATE_DIR, PROFILES_FILE } from './config';
import { synthesizeProfile } from './imitation';

// Token budgets for the two profile tiers. Enforced inside the synthesis
// prompt and via max_tokens — not by counting tokens here.
export const GENERAL_PROFILE_TOKEN_BUDGET = 10_000;
export const USER_PROFILE_TOKEN_BUDGET = 5_000;

const GENERAL_FILE = path.join(STATE_DIR, 'general_assessments.json');
const USER_DIR = path.join(STATE_DIR, 'user_assessments');
const ARCHIVE_FILE = path.join(STATE_DIR, 'assessments-archive.json');

function userFile(userId: UserId): string {
  return path.join(USER_DIR, `${userId}.json`);
}

function readProfileFile(file: string): string | null {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return typeof raw.profile === 'string' && raw.profile.length > 0 ? raw.profile : null;
  } catch { return null; }
}

export function getGeneralAssessment(): string | null {
  return readProfileFile(GENERAL_FILE);
}

export function getUserAssessment(userId: UserId): string | null {
  return readProfileFile(userFile(userId));
}

export function setGeneralAssessment(profile: string): void {
  fs.writeFileSync(GENERAL_FILE, JSON.stringify({ profile }, null, 2));
}

export function setUserAssessment(userId: UserId, profile: string): void {
  fs.mkdirSync(USER_DIR, { recursive: true });
  fs.writeFileSync(userFile(userId), JSON.stringify({ userId, profile }, null, 2));
}

// Parses the tagged output of generateAssessment into its two tiers.
// Tags are [general] and [user-specific] section headers. Untagged text is
// treated as user-specific, since the reflection is about a particular witness.
export function parseTaggedAssessment(text: string): { general?: string; userSpecific?: string } {
  const result: { general?: string; userSpecific?: string } = {};
  const re = /\[(general|user-specific)\]/gi;
  const matches = [...text.matchAll(re)];
  if (matches.length === 0) {
    const trimmed = text.trim();
    if (trimmed) result.userSpecific = trimmed;
    return result;
  }
  for (let i = 0; i < matches.length; i++) {
    const tag = matches[i][1].toLowerCase();
    const start = matches[i].index! + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : text.length;
    const section = text.slice(start, end).trim();
    if (!section) continue;
    const key = tag === 'general' ? 'general' : 'userSpecific';
    result[key] = result[key] ? `${result[key]}\n${section}` : section;
  }
  return result;
}

// Merge a new insight into the general profile. First insight is stored
// verbatim; afterwards each insight goes through one synthesis call.
export async function appendAndSynthesizeGeneralAssessment(newInsight: string, sessionId?: string): Promise<void> {
  const existing = getGeneralAssessment();
  if (existing === null) {
    setGeneralAssessment(newInsight);
    return;
  }
  const merged = await synthesizeProfile(existing, newInsight, GENERAL_PROFILE_TOKEN_BUDGET, true, sessionId);
  setGeneralAssessment(merged);
}

// Merge a new insight into a witness's profile. Same first-insight-verbatim rule.
export async function appendAndSynthesizeUserAssessment(userId: UserId, newInsight: string, sessionId?: string): Promise<void> {
  const existing = getUserAssessment(userId);
  if (existing === null) {
    setUserAssessment(userId, newInsight);
    return;
  }
  const merged = await synthesizeProfile(existing, newInsight, USER_PROFILE_TOKEN_BUDGET, false, sessionId);
  setUserAssessment(userId, merged);
}

interface LegacyAssessmentRecord {
  text: string;
  imitateeId: UserId; // 0 = general/compacted
  [k: string]: unknown;
}

// One-time migration: fold the legacy assessment list from user_profiles.json
// into the two profile tiers, archive the raw list, then clear it.
// Safe to call on every startup — no-ops once the list is empty.
export async function migrateAssessmentsToProfiles(): Promise<void> {
  let store: any;
  try {
    store = JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf8'));
  } catch { return; }
  const list: LegacyAssessmentRecord[] = store?.assessments?.list ?? [];
  if (list.length === 0) return;

  // Archive before anything else; never overwrite an existing archive.
  if (!fs.existsSync(ARCHIVE_FILE)) {
    fs.writeFileSync(ARCHIVE_FILE, JSON.stringify({ archivedAt: new Date().toISOString(), assessments: list }, null, 2));
  }

  const general = list.filter(r => !r.imitateeId || r.imitateeId === 0);
  const byUser = new Map<UserId, LegacyAssessmentRecord[]>();
  for (const r of list) {
    if (!r.imitateeId || r.imitateeId === 0) continue;
    const arr = byUser.get(r.imitateeId) ?? [];
    arr.push(r);
    byUser.set(r.imitateeId, arr);
  }

  const numbered = (rs: LegacyAssessmentRecord[]) => rs.map((r, i) => `${i + 1}. ${r.text}`).join('\n');

  if (general.length > 0) {
    const existing = getGeneralAssessment();
    if (general.length === 1 && existing === null) {
      setGeneralAssessment(general[0].text);
    } else {
      const merged = await synthesizeProfile(existing ?? '', numbered(general), GENERAL_PROFILE_TOKEN_BUDGET, true);
      setGeneralAssessment(merged);
    }
  }

  for (const [userId, records] of byUser) {
    const existing = getUserAssessment(userId);
    if (records.length === 1 && existing === null) {
      setUserAssessment(userId, records[0].text);
    } else {
      const merged = await synthesizeProfile(existing ?? '', numbered(records), USER_PROFILE_TOKEN_BUDGET, false);
      setUserAssessment(userId, merged);
    }
  }

  // Only clear after every tier migrated successfully.
  store.assessments = { list: [] };
  fs.writeFileSync(PROFILES_FILE, JSON.stringify(store, null, 2));
  console.log(`Migrated ${list.length} legacy assessments into rolling profiles (archived to ${ARCHIVE_FILE}).`);
}
