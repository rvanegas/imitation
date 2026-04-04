import * as fs from 'fs';
import * as path from 'path';
import { GameSession, TranscriptEntry } from './types';

const LOG_DIR = path.join(process.cwd(), 'logs');

function formatTranscript(transcript: TranscriptEntry[]): string {
  let lastHumanRole: 'user1' | 'user2' | null = null;
  const lines: string[] = [];
  for (const entry of transcript) {
    if (entry.role === 'guess') {
      const guesserLabel = entry.guesser === 'user1' ? 'User 1' : 'User 2';
      const verdict = entry.correct ? 'CORRECT' : 'WRONG';
      lines.push(`[${guesserLabel} guessed: ${entry.content} — ${verdict}]`);
    } else if (entry.role === 'model') {
      const label = lastHumanRole === 'user1' ? '[User 1 imitation]' : '[User 2 imitation]';
      lines.push(`${label}: ${entry.content}`);
    } else {
      lastHumanRole = entry.role;
      const label = entry.role === 'user1' ? '[User 1]' : '[User 2]';
      lines.push(`${label}: ${entry.content}`);
    }
  }
  return lines.join('\n');
}

export function logSession(session: GameSession): void {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `session-${session.id}-${timestamp}.txt`;
  const filepath = path.join(LOG_DIR, filename);

  const header = [
    `Session: ${session.id}`,
    `Variation: ${session.variation}`,
    `User 1: ${session.user1}`,
    `User 2: ${session.user2}`,
    `Ended: ${new Date().toISOString()}`,
    '',
    '--- Transcript (as sent to model) ---',
    '',
  ].join('\n');

  fs.writeFileSync(filepath, header + formatTranscript(session.transcript));
}
