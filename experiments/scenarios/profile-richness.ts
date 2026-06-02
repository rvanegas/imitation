import { ScriptedTransport } from '../ScriptedTransport';
import { TokenLedger } from '../TokenLedger';
import * as engine from '../../src/engine';
import * as sessionMod from '../../src/session';
import { appendMessage } from '../../src/userProfiles';
import { STATE_DIR } from '../../src/config';
import * as path from 'path';

const AUDIT_FILE = path.join(STATE_DIR, 'cost-audit.jsonl');

async function runOneRound(
  uid1: number,
  uid2: number,
  profileSize: number,
): Promise<string> {
  const transport = new ScriptedTransport();

  // Seed witness (uid2) profile with profileSize prior messages
  for (let i = 0; i < profileSize; i++) {
    appendMessage(uid2, uid1, `Prior message ${i + 1} from the witness about various topics.`);
  }

  await engine.handleStart(uid1, transport);
  const link = transport.lastMessage(uid1)!;
  const token = ScriptedTransport.tokenFromLink(link.split('\n')[1].trim());
  await engine.handleJoin(uid2, token, transport);

  const s = sessionMod.getSessionForParticipant(uid1)!;
  const sessionId = s.id;

  const judgeId = s.interrogator;
  const witnessId = judgeId === uid1 ? uid2 : uid1;

  transport.clear();
  await engine.handleMessage(judgeId, 'What do you think about this topic?', transport);
  await engine.handleMessage(witnessId, 'I have a clear perspective on this.', transport);
  s.imitationFirst = false;
  await engine.handleHuman(judgeId, 'A', transport);

  // Clean up session so UIDs can be reused
  await engine.handleLeave(uid1, transport);
  await engine.handleLeave(uid2, transport);

  return sessionId;
}

export async function run(): Promise<void> {
  engine.initSessions(new ScriptedTransport());

  console.log('Comparing first-round context size across profile sizes: 0, 10, 50 messages\n');

  const base = Date.now();
  const profiles = [0, 10, 50];

  for (const size of profiles) {
    const uid1 = base + size * 100;
    const uid2 = uid1 + 1;

    console.log(`\n--- Profile size: ${size} messages ---`);
    const sessionId = await runOneRound(uid1, uid2, size);

    const ledger = new TokenLedger(sessionId, AUDIT_FILE);
    ledger.printSummary();
  }
}
