import * as fs from 'fs';
import * as path from 'path';

const LOG_PATH = path.join(process.cwd(), 'logs', 'diag.log');

function write(line: string): void {
  const entry = `${new Date().toISOString()} ${line}\n`;
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.appendFileSync(LOG_PATH, entry);
  } catch {
    // best-effort
  }
}

export function diagProcessStart(): void {
  write(`PROCESS_START pid=${process.pid}`);
}

export function diagSessionsLoaded(count: number): void {
  write(`SESSIONS_LOADED count=${count}`);
}

export function diagSessionCreated(sessionId: string, user1: number, user2: number): void {
  write(`SESSION_CREATED session=${sessionId} user1=${user1} user2=${user2}`);
}

export function diagSessionEnded(sessionId: string, reason: 'explicit' | 'timeout'): void {
  write(`SESSION_ENDED session=${sessionId} reason=${reason}`);
}


export function diagNoSession(userId: number, context: string): void {
  write(`NO_SESSION user=${userId} context=${context}`);
}
