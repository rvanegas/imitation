import { ScriptedTransport } from '../ScriptedTransport';
import { TokenLedger } from '../TokenLedger';
import * as engine from '../../src/engine';
import * as sessionMod from '../../src/session';
import { STATE_DIR } from '../../src/config';
import * as path from 'path';

const ROUNDS = 25;
const AUDIT_FILE = path.join(STATE_DIR, 'cost-audit.jsonl');

export async function run(): Promise<void> {
  const transport = new ScriptedTransport();
  const uid1 = Date.now();
  const uid2 = uid1 + 1;

  engine.initSessions(transport);

  await engine.handleStart(uid1, transport);
  const link = transport.lastMessage(uid1)!;
  const token = ScriptedTransport.tokenFromLink(link.split('\n')[1].trim());
  await engine.handleJoin(uid2, token, transport);

  const s = sessionMod.getSessionForParticipant(uid1)!;
  const sessionId = s.id;
  console.log(`Session: ${sessionId}`);
  console.log(`Running ${ROUNDS} rounds (compaction fires after round 20)...\n`);

  for (let i = 0; i < ROUNDS; i++) {
    const judgeId = s.interrogator;
    const witnessId = judgeId === uid1 ? uid2 : uid1;

    transport.clear();
    await engine.handleMessage(
      judgeId,
      `Round ${i + 1} question: what are your thoughts on subject number ${i + 1}?`,
      transport,
    );
    await engine.handleMessage(witnessId, `Round ${i + 1} answer: I have quite a lot of thoughts on this topic.`, transport);
    s.imitationFirst = false;
    await engine.handleHuman(judgeId, 'A', transport);

    // Give compaction async call time to complete before next prediction
    if (i === 19) {
      await new Promise(r => setTimeout(r, 3000));
      console.log('\n  (compaction window — waiting for async compact to finish)');
    }

    process.stdout.write(`  Round ${i + 1} done\r`);
  }

  console.log('\n\nFull token trace (watch for drop after round 20):\n');
  const ledger = new TokenLedger(sessionId, AUDIT_FILE);
  ledger.printSummary();
}
