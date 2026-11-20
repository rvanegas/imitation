import { describe, it, expect } from 'vitest';
import { appendMessage, getLeaderboard, recordRoundResult, setName } from '../src/userProfiles';

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
