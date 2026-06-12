import { vi, describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

vi.mock('../src/imitation', () => ({
  synthesizeProfile: vi.fn().mockResolvedValue('merged profile'),
}));

import {
  parseTaggedAssessment,
  getGeneralAssessment, setGeneralAssessment,
  getUserAssessment, setUserAssessment,
  appendAndSynthesizeGeneralAssessment, appendAndSynthesizeUserAssessment,
  migrateAssessmentsToProfiles,
} from '../src/assessments';
import { synthesizeProfile } from '../src/imitation';
import { STATE_DIR, PROFILES_FILE } from '../src/config';

const GENERAL_FILE = path.join(STATE_DIR, 'general_assessments.json');
const USER_DIR = path.join(STATE_DIR, 'user_assessments');
const ARCHIVE_FILE = path.join(STATE_DIR, 'assessments-archive.json');

beforeEach(() => {
  vi.mocked(synthesizeProfile).mockClear();
  try { fs.unlinkSync(GENERAL_FILE); } catch {}
  try { fs.unlinkSync(ARCHIVE_FILE); } catch {}
  try { fs.rmSync(USER_DIR, { recursive: true }); } catch {}
});

describe('parseTaggedAssessment', () => {
  it('splits general and user-specific sections', () => {
    const out = parseTaggedAssessment('[general]\nHumans are terse.\n[user-specific]\nAlice avoids questions.');
    expect(out.general).toBe('Humans are terse.');
    expect(out.userSpecific).toBe('Alice avoids questions.');
  });

  it('handles a single section', () => {
    const out = parseTaggedAssessment('[user-specific]\nBob uses lowercase.');
    expect(out.general).toBeUndefined();
    expect(out.userSpecific).toBe('Bob uses lowercase.');
  });

  it('treats untagged text as user-specific', () => {
    const out = parseTaggedAssessment('The witness writes short replies.');
    expect(out.general).toBeUndefined();
    expect(out.userSpecific).toBe('The witness writes short replies.');
  });

  it('is case-insensitive and merges repeated tags', () => {
    const out = parseTaggedAssessment('[General]\nA.\n[GENERAL]\nB.');
    expect(out.general).toBe('A.\nB.');
  });

  it('ignores empty sections', () => {
    const out = parseTaggedAssessment('[general]\n\n[user-specific]\nC.');
    expect(out.general).toBeUndefined();
    expect(out.userSpecific).toBe('C.');
  });
});

describe('profile storage', () => {
  it('returns null when no profile exists', () => {
    expect(getGeneralAssessment()).toBeNull();
    expect(getUserAssessment(42)).toBeNull();
  });

  it('round-trips general and user profiles', () => {
    setGeneralAssessment('general wisdom');
    setUserAssessment(42, 'alice profile');
    expect(getGeneralAssessment()).toBe('general wisdom');
    expect(getUserAssessment(42)).toBe('alice profile');
    expect(getUserAssessment(43)).toBeNull();
  });
});

describe('appendAndSynthesize', () => {
  it('stores the first insight verbatim without a synthesis call', async () => {
    await appendAndSynthesizeGeneralAssessment('first lesson');
    expect(getGeneralAssessment()).toBe('first lesson');
    expect(synthesizeProfile).not.toHaveBeenCalled();
  });

  it('synthesizes subsequent insights into the existing profile', async () => {
    setGeneralAssessment('existing');
    await appendAndSynthesizeGeneralAssessment('new lesson', 'sess1');
    expect(synthesizeProfile).toHaveBeenCalledWith('existing', 'new lesson', expect.any(Number), true, 'sess1');
    expect(getGeneralAssessment()).toBe('merged profile');
  });

  it('does the same per user', async () => {
    await appendAndSynthesizeUserAssessment(7, 'first');
    expect(getUserAssessment(7)).toBe('first');
    await appendAndSynthesizeUserAssessment(7, 'second');
    expect(synthesizeProfile).toHaveBeenCalledWith('first', 'second', expect.any(Number), false, undefined);
    expect(getUserAssessment(7)).toBe('merged profile');
  });
});

describe('migrateAssessmentsToProfiles', () => {
  function writeLegacyStore(assessments: Array<{ text: string; imitateeId: number }>) {
    fs.writeFileSync(PROFILES_FILE, JSON.stringify({
      counter: 0, nextId: 10, users: {}, pairs: {},
      assessments: { list: assessments.map(a => ({ ...a, sessionId: '', guessNumber: 0, correct: false, timestamp: '2026-01-01T00:00:00Z' })) },
    }));
  }

  it('no-ops when there are no legacy assessments', async () => {
    writeLegacyStore([]);
    await migrateAssessmentsToProfiles();
    expect(fs.existsSync(ARCHIVE_FILE)).toBe(false);
    expect(getGeneralAssessment()).toBeNull();
  });

  it('archives, folds into profiles, and clears the list', async () => {
    writeLegacyStore([
      { text: 'general lesson', imitateeId: 0 },
      { text: 'alice 1', imitateeId: 3 },
      { text: 'alice 2', imitateeId: 3 },
      { text: 'bob only', imitateeId: 4 },
    ]);
    await migrateAssessmentsToProfiles();

    // Archive preserved
    const archive = JSON.parse(fs.readFileSync(ARCHIVE_FILE, 'utf8'));
    expect(archive.assessments).toHaveLength(4);

    // Single-entry tiers stored verbatim; multi-entry tiers synthesized
    expect(getGeneralAssessment()).toBe('general lesson');
    expect(getUserAssessment(3)).toBe('merged profile');
    expect(getUserAssessment(4)).toBe('bob only');

    // Legacy list cleared, rest of store intact
    const store = JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf8'));
    expect(store.assessments.list).toHaveLength(0);
    expect(store.nextId).toBe(10);
  });

  it('is idempotent', async () => {
    writeLegacyStore([{ text: 'general lesson', imitateeId: 0 }]);
    await migrateAssessmentsToProfiles();
    const calls = vi.mocked(synthesizeProfile).mock.calls.length;
    await migrateAssessmentsToProfiles();
    expect(vi.mocked(synthesizeProfile).mock.calls.length).toBe(calls);
  });
});
