import { vi, describe, it, expect } from 'vitest';

vi.mock('../src/imitation', () => ({
  generatePrediction: vi.fn().mockResolvedValue({ text: 'mock prediction', systemPrompt: 'mock prompt' }),
  generateAssessment: vi.fn().mockResolvedValue('mock assessment'),
  checkMessageFairness: vi.fn().mockResolvedValue({ fair: true, reason: '' }),
  buildCachedBlock: vi.fn().mockReturnValue([{ text: 'mock cached block', cache: true }]),
  synthesizeProfile: vi.fn().mockResolvedValue('mock synthesized profile'),
}));

import { deliverToReceiver, deliverToSpectators } from '../src/delivery';
import { MockTransport } from './helpers/MockTransport';
import { GameSession } from '../src/types';

function makeSession(overrides: Partial<GameSession> = {}): GameSession {
  return {
    id: 'test-session',
    user1: 1,
    user2: 2,
    status: 'active',
    imitationFirst: true,
    timeoutHandle: null as any,
    transcript: [],
    pendingResponder: null,
    interrogator: 1,
    pendingPrediction: null,
    pendingSystemPrompt: null,
    teamScores: { humans: 0, model: 0 },
    winStreak: 0,
    longestWinStreak: 0,
    currentRoundTurns: 0,
    totalTurns: 0,
    roundCount: 0,
    spectators: [],
    createdAt: 0,
    lastActivity: 0,
    ...overrides,
  };
}

const SCORE = {
  humans: 0, model: 0, humanPct: 0, modelPct: 0,
  streak: 0, bestStreak: 0, round: 0, avgTurns: null,
};

describe('deliverToReceiver', () => {
  it('imitationFirst=true puts prediction as A, human as B', async () => {
    const transport = new MockTransport();
    await deliverToReceiver(transport, 1, { human: 'human text', prediction: 'pred text' }, true, SCORE);
    const text = transport.lastMessage(1)!;
    expect(text).toMatch(/A:.*pred text/);
    expect(text).toMatch(/B:.*human text/);
    const ev = transport.getEvents(1)[0];
    expect(ev).toMatchObject({ kind: 'decide', a: 'pred text', b: 'human text' });
  });

  it('imitationFirst=false puts human as A, prediction as B', async () => {
    const transport = new MockTransport();
    await deliverToReceiver(transport, 1, { human: 'human text', prediction: 'pred text' }, false, SCORE);
    const text = transport.lastMessage(1)!;
    expect(text).toMatch(/A:.*human text/);
    expect(text).toMatch(/B:.*pred text/);
    const ev = transport.getEvents(1)[0];
    expect(ev).toMatchObject({ kind: 'decide', a: 'human text', b: 'pred text' });
  });
});

describe('deliverToSpectators', () => {
  it('sends both sides with labels to each spectator', async () => {
    const transport = new MockTransport();
    const session = makeSession({ spectators: [3, 4] });
    await deliverToSpectators(transport, session, 'Alice', 'human reply', 'pred reply');

    for (const uid of [3, 4]) {
      const msgs = transport.getMessages(uid);
      expect(msgs.length).toBeGreaterThan(0);
      expect(msgs[0]).toContain('Alice');
      expect(msgs[0]).toContain('human reply');
      expect(msgs[0]).toContain('pred reply');
    }
  });

  it('removes failed spectators from the session', async () => {
    const failingId = 99;
    const transport = new MockTransport();
    vi.spyOn(transport, 'send').mockImplementation(async (userId, _text) => {
      if (userId === failingId) throw new Error('send failed');
    });

    const session = makeSession({ spectators: [failingId, 5] });
    await deliverToSpectators(transport, session, 'Bob', 'msg', 'pred');

    expect(session.spectators).not.toContain(failingId);
    expect(session.spectators).toContain(5);
  });
});
