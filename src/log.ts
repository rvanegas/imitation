import * as fs from 'fs';
import * as path from 'path';
import { GameSession, TranscriptEntry } from './types';
import { getAssessments } from './userProfiles';

const LOG_DIR = path.join(process.cwd(), 'logs');

function formatTranscript(transcript: TranscriptEntry[], session: GameSession): string {
  const id1 = String(session.user1);
  const id2 = String(session.user2);
  let lastHumanRole: 'user1' | 'user2' | null = null;
  const lines: string[] = [];
  for (const entry of transcript) {
    if (entry.role === 'guess') {
      const guesserLabel = entry.guesser === 'user1' ? id1 : id2;
      const verdict = entry.correct ? 'CORRECT' : 'WRONG';
      lines.push(`[${guesserLabel} guessed: ${entry.content} — ${verdict}]`);
    } else if (entry.role === 'model') {
      const label = lastHumanRole === 'user1' ? `[${id1} imitation]` : `[${id2} imitation]`;
      lines.push(`${label}: ${entry.content}`);
    } else {
      lastHumanRole = entry.role;
      const label = entry.role === 'user1' ? `[${id1}]` : `[${id2}]`;
      lines.push(`${label}: ${entry.content}`);
    }
  }
  return lines.join('\n');
}

function writeLog(session: GameSession, ended: boolean): void {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

  const filepath = path.join(LOG_DIR, `session-${session.id}.txt`);

  const headerLines = [
    `Session: ${session.id}`,
    `Variation: ${session.variation}`,
    `User 1: ${session.user1}`,
    `User 2: ${session.user2}`,
  ];
  if (ended) headerLines.push(`Ended: ${new Date().toISOString()}`);

  const assessments = getAssessments();
  headerLines.push('', '--- Assessments ---', '');
  if (assessments.length === 0) {
    headerLines.push('(none)');
  } else {
    assessments.forEach((a, i) => headerLines.push(`${i + 1}. ${a}`));
  }

  headerLines.push('', '--- System Prompt ---', '');
  headerLines.push(session.lastSystemPrompt ?? '(not yet generated)');

  headerLines.push('', '--- Transcript (as sent to model) ---', '');

  fs.writeFileSync(filepath, headerLines.join('\n') + formatTranscript(session.transcript, session));
}

export function updateLog(session: GameSession): void {
  writeLog(session, false);
}

export function logSession(session: GameSession): void {
  writeLog(session, true);
}
