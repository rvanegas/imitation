import { ScriptedTransport } from '../ScriptedTransport';
import { TokenLedger } from '../TokenLedger';
import * as engine from '../../src/engine';
import * as sessionMod from '../../src/session';
import { STATE_DIR } from '../../src/config';
import * as path from 'path';

const ROUNDS = 10;
const AUDIT_FILE = path.join(STATE_DIR, 'cost-audit.jsonl');

export async function run(): Promise<void> {
  const transport = new ScriptedTransport();
  let uid1 = Date.now();
  let uid2 = uid1 + 1;

  engine.initSessions(transport);

  // Start game
  await engine.handleStart(uid1, transport);
  const link = transport.lastMessage(uid1)!;
  const token = ScriptedTransport.tokenFromLink(link.split('\n')[1].trim());
  await engine.handleJoin(uid2, token, transport);

  const s = sessionMod.getSessionForParticipant(uid1)!;
  const sessionId = s.id;
  console.log(`Session: ${sessionId}`);
  console.log(`Running ${ROUNDS} rounds with fresh users...\n`);

  for (let i = 0; i < ROUNDS; i++) {
    const judgeId = s.interrogator;
    const witnessId = judgeId === uid1 ? uid2 : uid1;

    transport.clear();
    await engine.handleMessage(judgeId, `Question ${i + 1}: what do you think about topic ${i + 1}?`, transport);
    await engine.handleMessage(witnessId, `My answer to question ${i + 1} is pretty interesting I think.`, transport);

    // Force a valid call
    s.imitationFirst = false;
    await engine.handleHuman(judgeId, 'A', transport);

    process.stdout.write(`  Round ${i + 1} done\r`);
  }

  console.log('\n\nToken usage per round:\n');
  const ledger = new TokenLedger(sessionId, AUDIT_FILE);
  ledger.printSummary();
}
