import { describe, it, expect } from 'vitest';
import { appendMessage, getLeaderboard, recordRoundResult, setName } from '../src/userProfiles';
import { statsFromLogs } from '../src/rebuildStats';

describe('pair stats', () => {
  it('survive a message from the player with the lower id', () => {
    setName(1, 'Ann');
    setName(2, 'Bob');
    recordRoundResult(1, 2, false, 0);
    recordRoundResult(1, 2, true, 1);
    appendMessage(1, 2, 'hello');
    appendMessage(2, 1, 'hi');
    expect(getLeaderboard()).toEqual([{ name: 'Ann & Bob', wins: 1, losses: 1, bestStreak: 1 }]);
  });
});

describe('statsFromLogs', () => {
  const log = (u1: string, u2: string, calls: string[]) =>
    [`Session: 1`, `User 1: ${u1}`, `User 2: ${u2}`, '', '--- Transcript ---', '',
     ...calls.map(v => `[${u1} called: A (A was the human, B was the model.) — ${v}]`)].join('\n');

  it('totals calls by pair, with streaks within a session', () => {
    expect(statsFromLogs([
      log('3', '1', ['CORRECT', 'CORRECT', 'WRONG', 'CORRECT']),
      log('1', '3', ['CORRECT', 'CORRECT', 'CORRECT']),
    ])).toEqual({ '1:3': { wins: 6, losses: 1, bestStreak: 3 } });
  });

  it('skips logs without both players or without calls', () => {
    expect(statsFromLogs([log('null', 'null', []), log('1', '2', [])])).toEqual({});
  });
});
