import { ScriptedTransport } from '../ScriptedTransport';
import { TokenLedger } from '../TokenLedger';
import * as engine from '../../src/engine';
import * as sessionMod from '../../src/session';
import { STATE_DIR } from '../../src/config';
import * as path from 'path';

const ROUNDS_PER_GAME = 5;
const AUDIT_FILE = path.join(STATE_DIR, 'cost-audit.jsonl');

async function runGame(
  uid1: number,
  uid2: number,
  transport: ScriptedTransport,
  gameLabel: string,
): Promise<string> {
  await engine.handleStart(uid1, transport);
  const link = transport.lastMessage(uid1)!;
  const token = ScriptedTransport.tokenFromLink(link.split('\n')[1].trim());
  await engine.handleJoin(uid2, token, transport);

  const s = sessionMod.getSessionForParticipant(uid1)!;
  const sessionId = s.id;
  console.log(`${gameLabel} session: ${sessionId}`);

  for (let i = 0; i < ROUNDS_PER_GAME; i++) {
    const judgeId = s.interrogator;
    const witnessId = judgeId === uid1 ? uid2 : uid1;

    transport.clear();
    await engine.handleMessage(judgeId, `Game message ${i + 1}`, transport);
    await engine.handleMessage(witnessId, `My reply ${i + 1}`, transport);
    s.imitationFirst = false;
    await engine.handleHuman(judgeId, 'A', transport);
    process.stdout.write(`  Round ${i + 1} done\r`);
  }
  console.log();

  // End session so same UIDs can start a new game
  await engine.handleLeave(uid1, transport);
  await engine.handleLeave(uid2, transport);

  return sessionId;
}

export async function run(): Promise<void> {
  const transport = new ScriptedTransport();
  const uid1 = Date.now();
  const uid2 = uid1 + 1;

  engine.initSessions(transport);

  console.log(`Running two successive ${ROUNDS_PER_GAME}-round games with the same users...\n`);

  const sessionId1 = await runGame(uid1, uid2, transport, 'Game 1');
  const sessionId2 = await runGame(uid1, uid2, transport, 'Game 2');

  const ledger1 = new TokenLedger(sessionId1, AUDIT_FILE);
  const ledger2 = new TokenLedger(sessionId2, AUDIT_FILE);

  console.log('\nGame 1 token usage:\n');
  ledger1.printSummary();

  console.log('\nGame 2 token usage:\n');
  ledger2.printSummary();
}
