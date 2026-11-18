import { vi, describe, it, expect } from 'vitest';

vi.mock('../src/imitation', () => ({
  generatePrediction: vi.fn().mockResolvedValue({ text: 'mock prediction', systemPrompt: 'mock prompt' }),
  generateAssessment: vi.fn().mockResolvedValue('mock assessment'),
  checkMessageFairness: vi.fn().mockResolvedValue({ fair: true, reason: '' }),
  buildCachedBlock: vi.fn().mockReturnValue([{ text: 'mock cached block', cache: true }]),
  synthesizeProfile: vi.fn().mockResolvedValue('mock synthesized profile'),
}));

import * as engine from '../src/engine';
import * as sessionMod from '../src/session';
import { MockTransport } from './helpers/MockTransport';
import { startGame, playRound, nextUid } from './helpers/gameHelpers';
import { getProfile } from '../src/userProfiles';

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
    s.imitationFirst = false; // A=human, B=model → /a is correct

    await playRound(setup, 'Question?', 'Answer!', 'A');

    const fresh = sessionMod.getSessionForParticipant(uid1) ?? sessionMod.getSessionForParticipant(uid2);
    expect(fresh!.teamScores.humans).toBe(1);
    expect(fresh!.teamScores.model).toBe(0);
  });

  it('wrong call increments model score', async () => {
    const setup = await startGame();
    const { uid1, uid2 } = setup;
    const s = sessionMod.getSessionForParticipant(uid1)!;
    s.imitationFirst = false; // A=human, B=model → /b is wrong

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

describe('void', () => {
  function seats(uid1: number, uid2: number) {
    const s = sessionMod.getSessionForParticipant(uid1)!;
    const judgeId = s.interrogator;
    return { s, judgeId, witnessId: judgeId === uid1 ? uid2 : uid1 };
  }

  it('voiding an answered exchange takes back all three entries and returns the turn to the judge', async () => {
    const setup = await startGame();
    const { uid1, uid2, transport } = setup;
    const { s, judgeId, witnessId } = seats(uid1, uid2);

    await engine.handleMessage(judgeId, 'Remember the party at Ana\'s?', transport);
    await engine.handleMessage(witnessId, 'Of course, the cake!', transport);
    transport.clear();
    await engine.handleVoid(witnessId, transport);

    expect(s.transcript).toHaveLength(0);
    expect(s.pendingResponder).toBeNull();
    expect(s.currentRoundTurns).toBe(0);
    expect(transport.lastMessage(judgeId)).toMatch(/voided the last question and its answers.*ask something else/);
    expect(getProfile(judgeId, witnessId).messages).not.toContain('Remember the party at Ana\'s?');
    expect(getProfile(witnessId, judgeId).messages).not.toContain('Of course, the cake!');
  });

  it('voiding an unanswered question drops it and its prediction', async () => {
    const setup = await startGame();
    const { uid1, uid2, transport } = setup;
    const { s, judgeId, witnessId } = seats(uid1, uid2);

    await engine.handleMessage(judgeId, 'How was your sister\'s wedding?', transport);
    await engine.handleVoid(judgeId, transport);

    expect(s.transcript).toHaveLength(0);
    expect(s.pendingResponder).toBeNull();
    expect(s.pendingPrediction).toBeNull();
    expect(transport.lastMessage(witnessId)).toMatch(/voided the question/);
  });

  it('keeps the earlier exchanges of the round', async () => {
    const setup = await startGame();
    const { uid1, uid2, transport } = setup;
    const { s, judgeId, witnessId } = seats(uid1, uid2);

    await engine.handleMessage(judgeId, 'Q1', transport);
    await engine.handleMessage(witnessId, 'A1', transport);
    await engine.handleMessage(judgeId, 'Q2', transport);
    await engine.handleMessage(witnessId, 'A2', transport);
    await engine.handleVoid(judgeId, transport);

    expect(s.transcript.map(e => e.content)).toEqual(['Q1', 'A1', 'mock prediction']);
    expect(s.currentRoundTurns).toBe(1);
  });

  it('a call cannot be voided, and an empty round has nothing to void', async () => {
    const setup = await startGame();
    const { uid1, uid2, transport } = setup;

    await engine.handleVoid(uid1, transport);
    expect(transport.lastMessage(uid1)).toMatch(/nothing in this round to void/);

    await playRound(setup, 'Q', 'An answer', 'A');
    const { s } = seats(uid1, uid2);
    expect(s.roundCount).toBe(1);
    const before = s.transcript.length;
    await engine.handleVoid(uid2, transport);
    expect(s.transcript).toHaveLength(before);
    expect(transport.lastMessage(uid2)).toMatch(/nothing in this round to void/);
  });

  it('the judge cannot call once the round\'s only exchange is voided', async () => {
    const setup = await startGame();
    const { uid1, uid2, transport } = setup;
    await playRound(setup, 'Q0', 'A0', 'A');

    const { s, judgeId, witnessId } = seats(uid1, uid2);
    await engine.handleMessage(judgeId, 'Q1', transport);
    await engine.handleMessage(witnessId, 'A1', transport);
    await engine.handleVoid(judgeId, transport);
    const rounds = s.roundCount;
    await engine.handleHuman(judgeId, 'A', transport);

    expect(s.roundCount).toBe(rounds);
    expect(transport.lastMessage(judgeId)).toMatch(/no exchange has happened yet/);
  });
});

describe('command menu', () => {
  // Telegram refuses the whole menu if one entry breaks its rules, and the
  // refusal reaches only the server log.
  it('every command is one Telegram accepts', () => {
    for (const c of engine.COMMANDS) {
      expect(c.command).toMatch(/^[a-z0-9_]{1,32}$/);
      const description = c.args ? `${c.args} — ${c.description}` : c.description;
      expect(description.length).toBeGreaterThan(0);
      expect(description.length).toBeLessThanOrEqual(256);
    }
  });
});
