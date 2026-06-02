import * as fs from 'fs';

interface AuditEntry {
  timestamp: string;
  operation: string;
  sessionId?: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
}

interface RoundStats {
  round: number;
  operation: string;
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
}

export class TokenLedger {
  constructor(
    private readonly sessionId: string,
    private readonly auditFile: string,
  ) {}

  readAll(): RoundStats[] {
    let lines: string[];
    try {
      lines = fs.readFileSync(this.auditFile, 'utf8').split('\n').filter(Boolean);
    } catch {
      return [];
    }

    const entries: AuditEntry[] = lines
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter((e): e is AuditEntry => e !== null && e.sessionId === this.sessionId);

    let round = 0;
    return entries.map(e => {
      if (e.operation === 'prediction') round++;
      return {
        round,
        operation: e.operation,
        input: e.inputTokens,
        output: e.outputTokens,
        cacheCreate: e.cacheCreationTokens ?? 0,
        cacheRead: e.cacheReadTokens ?? 0,
      };
    });
  }

  printSummary(): void {
    const rows = this.readAll();
    if (rows.length === 0) {
      console.log('  (no audit entries for this session)');
      return;
    }

    const header = 'Round  Op             Input   Output  CacheCreate  CacheRead  CacheHit%';
    console.log(header);
    console.log('-'.repeat(header.length));

    for (const r of rows) {
      const total = r.input + r.cacheRead;
      const hitPct = total > 0 ? Math.round((r.cacheRead / total) * 100) : 0;
      console.log(
        `  ${String(r.round).padStart(2)}   ${r.operation.padEnd(12)}  ` +
        `${String(r.input).padStart(6)}  ${String(r.output).padStart(6)}  ` +
        `${String(r.cacheCreate).padStart(11)}  ${String(r.cacheRead).padStart(9)}  ${hitPct}%`,
      );
    }
  }
}
