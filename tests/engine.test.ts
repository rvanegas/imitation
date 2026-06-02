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
import { startGame, playRound, nextUid } from './helpers/gameHelpers';

describe('invite flow', () => {
  it('handleStart sends an invite link', async () => {
    const transport = new MockTransport();
    const uid = nextUid();
    await engine.handleStart(uid, transport);
    const msg = transport.lastMessage(uid)!;
    expect(msg).toMatch(/test:\/\/join\//);
  });

  it('joining own token is rejected', async () => {
    const transport = new MockTransport();
    const uid = nextUid();
    await engine.handleStart(uid, transport);
    const link = transport.lastMessage(uid)!;
    const token = MockTransport.tokenFromLink(link.split('\n')[1].trim());
    transport.clear();

    await engine.handleJoin(uid, token, transport);
    expect(transport.lastMessage(uid)).toMatch(/own invite/);
  });

  it('valid join starts game for both players', async () => {
    const setup = await startGame();
    const { uid1, uid2 } = setup;

    const s = sessionMod.getSessionForParticipant(uid1)!;
    expect(s).toBeDefined();
    expect(s.user1).toBe(uid1);
    expect(s.user2).toBe(uid2);
  });
});

describe("judge's turn", () => {
  it('handleMessage sets pendingResponder and calls generatePrediction', async () => {
    const setup = await startGame();
    const { uid1, uid2, transport } = setup;
    const s = sessionMod.getSessionForParticipant(uid1)!;
    const judgeId = s.interrogator;
    const witnessId = judgeId === uid1 ? uid2 : uid1;

    await engine.handleMessage(judgeId, 'Hello there', transport);

    const fresh = sessionMod.getSessionForParticipant(uid1)!;
    expect(fresh.pendingResponder).toBe(witnessId);

    const { generatePrediction } = await import('../src/imitation');
    expect(generatePrediction).toHaveBeenCalled();
  });

  it('wrong-turn message is blocked', async () => {
    const setup = await startGame();
    const { uid1, uid2, transport } = setup;
    const s = sessionMod.getSessionForParticipant(uid1)!;
    const judgeId = s.interrogator;
    const nonJudge = judgeId === uid1 ? uid2 : uid1;

    transport.clear();
    await engine.handleMessage(nonJudge, 'I should not go', transport);
    const msg = transport.lastMessage(nonJudge)!;
    expect(msg).toMatch(/waiting/i);
  });
});

describe('witness response', () => {
  it('A/B pair is delivered to the judge', async () => {
    const setup = await startGame();
    const { uid1, uid2, transport } = setup;
    const s = sessionMod.getSessionForParticipant(uid1)!;
    s.imitationFirst = true;
    const judgeId = s.interrogator;
    const witnessId = judgeId === uid1 ? uid2 : uid1;

    transport.clear();
    await engine.handleMessage(judgeId, 'Hello', transport);
    transport.clear();
    await engine.handleMessage(witnessId, 'My reply', transport);

    const judgeMessages = transport.getMessages(judgeId);
    const abMsg = judgeMessages.find(m => m.startsWith('A:') || m.startsWith('B:'));
    expect(abMsg).toBeDefined();
  });

  it('imitationFirst=true puts model as A', async () => {
    const setup = await startGame();
    const { uid1, uid2, transport } = setup;
    const s = sessionMod.getSessionForParticipant(uid1)!;
    s.imitationFirst = true;
    const judgeId = s.interrogator;
    const witnessId = judgeId === uid1 ? uid2 : uid1;

    transport.clear();
    await engine.handleMessage(judgeId, 'Hello', transport);
    transport.clear();
    await engine.handleMessage(witnessId, 'My reply', transport);

    const judgeMessages = transport.getMessages(judgeId);
    const aMsg = judgeMessages.find(m => m.startsWith('A:'));
    expect(aMsg).toContain('mock prediction');
  });

  it('imitationFirst=false puts human as A', async () => {
    const setup = await startGame();
    const { uid1, uid2, transport } = setup;
    const s = sessionMod.getSessionForParticipant(uid1)!;
    s.imitationFirst = false;
    const judgeId = s.interrogator;
    const witnessId = judgeId === uid1 ? uid2 : uid1;

    transport.clear();
    await engine.handleMessage(judgeId, 'Hello', transport);
    transport.clear();
    await engine.handleMessage(witnessId, 'My reply', transport);

    const judgeMessages = transport.getMessages(judgeId);
    const aMsg = judgeMessages.find(m => m.startsWith('A:'));
    expect(aMsg).toContain('My reply');
  });
});

describe('judge call + scoring', () => {
  it('correct call increments humans score', async () => {
    const setup = await startGame();
    const { uid1, uid2 } = setup;
    const s = sessionMod.getSessionForParticipant(uid1)!;
    s.imitationFirst = false; // A=human, B=model → /human A is correct

    await playRound(setup, 'Question?', 'Answer!', 'A');

    const fresh = sessionMod.getSessionForParticipant(uid1) ?? sessionMod.getSessionForParticipant(uid2);
    expect(fresh!.teamScores.humans).toBe(1);
    expect(fresh!.teamScores.model).toBe(0);
  });

  it('wrong call increments model score', async () => {
    const setup = await startGame();
    const { uid1, uid2 } = setup;
    const s = sessionMod.getSessionForParticipant(uid1)!;
    s.imitationFirst = false; // A=human, B=model → /human B is wrong

    await playRound(setup, 'Question?', 'Answer!', 'B');

    const fresh = sessionMod.getSessionForParticipant(uid1) ?? sessionMod.getSessionForParticipant(uid2);
    expect(fresh!.teamScores.model).toBe(1);
    expect(fresh!.teamScores.humans).toBe(0);
  });

  it('roles swap after a round', async () => {
    const setup = await startGame();
    const { uid1 } = setup;
    const s = sessionMod.getSessionForParticipant(uid1)!;
    const originalJudge = s.interrogator;
    s.imitationFirst = false;

    await playRound(setup, 'Question?', 'Answer!', 'A');

    const fresh = sessionMod.getSessionForParticipant(uid1)!;
    expect(fresh.interrogator).not.toBe(originalJudge);
  });
});

describe('multi-round', () => {
  it('3 rounds accumulate scores and roundCount', async () => {
    const setup = await startGame();
    const { uid1, uid2 } = setup;

    for (let i = 0; i < 3; i++) {
      const s = sessionMod.getSessionForParticipant(uid1)!;
      s.imitationFirst = false; // A=human
      await playRound(setup, `Q${i}`, `A${i}`, 'A');
    }

    const fresh = sessionMod.getSessionForParticipant(uid1) ?? sessionMod.getSessionForParticipant(uid2);
    expect(fresh!.roundCount).toBe(3);
    expect(fresh!.teamScores.humans + fresh!.teamScores.model).toBe(3);
  });
});
