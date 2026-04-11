import * as fs from 'fs';
import * as path from 'path';
import { STATE_DIR } from './config';

const AUDIT_FILE = path.join(STATE_DIR, 'cost-audit.jsonl');

interface CostAuditEntry {
  timestamp: string;
  operation: 'prediction' | 'assessment';
  sessionId?: string;
  provider: 'anthropic' | 'ollama';
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
}

export function appendCostAudit(entry: CostAuditEntry): void {
  try {
    fs.appendFileSync(AUDIT_FILE, JSON.stringify(entry) + '\n');
  } catch {
    // Best-effort — never let audit logging crash the server
  }
}
