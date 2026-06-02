import { MockTransport } from './MockTransport';
import * as engine from '../../src/engine';
import * as sessionMod from '../../src/session';

let uidCounter = 10000;
export function nextUid(): number { return uidCounter++; }

export interface GameSetup {
  transport: MockTransport;
  uid1: number;
  uid2: number;
  token: string;
}

export async function startGame(): Promise<GameSetup> {
  const transport = new MockTransport();
  const uid1 = nextUid();
  const uid2 = nextUid();

  await engine.handleStart(uid1, transport);
  const link = transport.lastMessage(uid1)!;
  const token = MockTransport.tokenFromLink(link.split('\n')[1].trim());
  transport.clear();

  await engine.handleJoin(uid2, token, transport);
  transport.clear();

  return { transport, uid1, uid2, token };
}

export async function playRound(
  setup: GameSetup,
  judgeMsg: string,
  witnessMsg: string,
  call: 'A' | 'B',
): Promise<void> {
  const { transport, uid1, uid2 } = setup;
  const s = sessionMod.getSessionForParticipant(uid1)!;
  const judgeId = s.interrogator;
  const witnessId = judgeId === uid1 ? uid2 : uid1;

  await engine.handleMessage(judgeId, judgeMsg, transport);
  await engine.handleMessage(witnessId, witnessMsg, transport);
  await engine.handleHuman(judgeId, call, transport);
}
