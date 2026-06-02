import { vi, describe, it, expect } from 'vitest';

vi.mock('../src/imitation', () => ({
  generatePrediction: vi.fn().mockResolvedValue({ text: 'mock prediction', systemPrompt: 'mock prompt' }),
  generateAssessment: vi.fn().mockResolvedValue('mock assessment'),
  checkMessageFairness: vi.fn().mockResolvedValue({ fair: true, reason: '' }),
  buildCachedBlock: vi.fn().mockReturnValue([{ text: 'mock cached block', cache: true }]),
  compactWitnessAssessments: vi.fn().mockResolvedValue('mock compacted'),
}));

import * as engine from '../src/engine';
import * as sessionMod from '../src/session';
import { MockTransport } from './helpers/MockTransport';
import { startGame, nextUid } from './helpers/gameHelpers';

describe('spectators', () => {
  it('spectator can join and receive round messages', async () => {
    const setup = await startGame();
    const { uid1, uid2, token, transport } = setup;
    const specUid = nextUid();

    await engine.handleJoin(specUid, token, transport);
    transport.clear();

    const s = sessionMod.getSessionForParticipant(uid1)!;
    expect(s.spectators).toContain(specUid);
  });

  it('spectator cannot call /human', async () => {
    const setup = await startGame();
    const { token, transport } = setup;
    const specUid = nextUid();

    await engine.handleJoin(specUid, token, transport);
    transport.clear();

    await engine.handleHuman(specUid, 'A', transport);
    expect(transport.lastMessage(specUid)).toMatch(/spectator/i);
  });
});

describe('player leave', () => {
  it('partner is notified when a player leaves', async () => {
    const setup = await startGame();
    const { uid1, uid2, transport } = setup;

    transport.clear();
    await engine.handleLeave(uid1, transport);

    const msgs = transport.getMessages(uid2);
    expect(msgs.some(m => m.includes('left'))).toBe(true);
  });

  it('session ends when both players leave', async () => {
    const setup = await startGame();
    const { uid1, uid2, transport } = setup;

    await engine.handleLeave(uid1, transport);
    await engine.handleLeave(uid2, transport);

    expect(sessionMod.getSessionForParticipant(uid1)).toBeUndefined();
    expect(sessionMod.getSessionForParticipant(uid2)).toBeUndefined();
  });
});

describe('/restart', () => {
  it('resets scores and transcript', async () => {
    const setup = await startGame();
    const { uid1, uid2, transport } = setup;

    // Assign explicit valid names so handleRestart can look them up
    await engine.handleSetName(uid1, 'playerOne', transport);
    await engine.handleSetName(uid2, 'playerTwo', transport);
    transport.clear();

    const s = sessionMod.getSessionForParticipant(uid1)!;
    s.teamScores = { humans: 2, model: 1 };
    s.transcript = [{ role: 'user1', content: 'old message' }];

    await engine.handleRestart(uid1, 'playerOne', 'playerTwo', transport);

    const fresh = sessionMod.getSessionForParticipant(uid1)!;
    expect(fresh.teamScores.humans).toBe(0);
    expect(fresh.teamScores.model).toBe(0);
    expect(fresh.transcript).toHaveLength(0);
  });
});

describe('/setname validation', () => {
  it('rejects names starting with a digit', async () => {
    const transport = new MockTransport();
    const uid = nextUid();
    await engine.handleSetName(uid, '1invalid', transport);
    expect(transport.lastMessage(uid)).toMatch(/invalid/i);
  });

  it('rejects duplicate names', async () => {
    const transport = new MockTransport();
    const uid1 = nextUid();
    const uid2 = nextUid();

    await engine.handleSetName(uid1, 'uniquename', transport);
    transport.clear();
    await engine.handleSetName(uid2, 'uniquename', transport);
    expect(transport.lastMessage(uid2)).toMatch(/taken/i);
  });

  it('accepts valid names', async () => {
    const transport = new MockTransport();
    const uid = nextUid();
    await engine.handleSetName(uid, 'validName_123', transport);
    expect(transport.lastMessage(uid)).toMatch(/validName_123/);
  });
});
