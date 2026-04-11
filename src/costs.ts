import * as fs from 'fs';
import * as path from 'path';
import { STATE_DIR, PRICING } from './config';

const AUDIT_FILE = path.join(STATE_DIR, 'cost-audit.jsonl');

interface CostAuditEntry {
  timestamp: string;
  operation: 'prediction' | 'assessment';
  sessionId?: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
}

function lookupPricing(model: string) {
  // Exact match first, then prefix match for versioned model IDs
  return PRICING[model] ?? Object.entries(PRICING).find(([k]) => model.startsWith(k))?.[1] ?? null;
}

function computeCost(e: CostAuditEntry): number | null {
  const p = lookupPricing(e.model);
  if (!p) return null;
  return (
    (e.inputTokens                / 1_000_000) * p.inputPerMillion +
    (e.outputTokens               / 1_000_000) * p.outputPerMillion +
    ((e.cacheCreationTokens ?? 0) / 1_000_000) * p.cacheWritePerMillion +
    ((e.cacheReadTokens     ?? 0) / 1_000_000) * p.cacheReadPerMillion
  );
}

function fmtCost(rows: CostAuditEntry[]): string {
  let sum = 0;
  let anyNull = false;
  for (const e of rows) {
    const c = computeCost(e);
    if (c === null) anyNull = true;
    else sum += c;
  }
  return `$${sum.toFixed(4)}${anyNull ? '?' : ''}`;
}

function readEntries(): CostAuditEntry[] {
  let raw: string;
  try {
    raw = fs.readFileSync(AUDIT_FILE, 'utf8');
  } catch (err: any) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  return raw
    .split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line) as CostAuditEntry);
}

function pad(s: string | number, width: number, right = false): string {
  const str = String(s);
  return right ? str.padStart(width) : str.padEnd(width);
}

export function showSummary(): void {
  const entries = readEntries();
  if (entries.length === 0) {
    console.log('No cost audit entries found.');
    return;
  }

  const ops = ['prediction', 'assessment'] as const;
  console.log(
    pad('operation', 12) +
    pad('calls', 8, true) +
    pad('input tokens', 14, true) +
    pad('output tokens', 15, true) +
    pad('cache create', 14, true) +
    pad('cache read', 12, true) +
    pad('cost (USD)', 12, true)
  );
  console.log('-'.repeat(87));

  let totalCalls = 0, totalIn = 0, totalOut = 0, totalCC = 0, totalCR = 0;
  const allRows: CostAuditEntry[] = [];
  for (const op of ops) {
    const rows = entries.filter(e => e.operation === op);
    if (rows.length === 0) continue;
    const inTok  = rows.reduce((s, e) => s + e.inputTokens, 0);
    const outTok = rows.reduce((s, e) => s + e.outputTokens, 0);
    const cc     = rows.reduce((s, e) => s + (e.cacheCreationTokens ?? 0), 0);
    const cr     = rows.reduce((s, e) => s + (e.cacheReadTokens ?? 0), 0);
    console.log(
      pad(op, 12) +
      pad(rows.length, 8, true) +
      pad(inTok.toLocaleString(), 14, true) +
      pad(outTok.toLocaleString(), 15, true) +
      pad(cc > 0 ? cc.toLocaleString() : '-', 14, true) +
      pad(cr > 0 ? cr.toLocaleString() : '-', 12, true) +
      pad(fmtCost(rows), 12, true)
    );
    totalCalls += rows.length;
    totalIn += inTok; totalOut += outTok; totalCC += cc; totalCR += cr;
    allRows.push(...rows);
  }

  console.log('-'.repeat(87));
  console.log(
    pad('total', 12) +
    pad(totalCalls, 8, true) +
    pad(totalIn.toLocaleString(), 14, true) +
    pad(totalOut.toLocaleString(), 15, true) +
    pad(totalCC > 0 ? totalCC.toLocaleString() : '-', 14, true) +
    pad(totalCR > 0 ? totalCR.toLocaleString() : '-', 12, true) +
    pad(fmtCost(allRows), 12, true)
  );
}

export function showBySession(): void {
  const entries = readEntries();
  if (entries.length === 0) {
    console.log('No cost audit entries found.');
    return;
  }

  const groups = new Map<string, CostAuditEntry[]>();
  for (const e of entries) {
    const key = e.sessionId ?? '(unknown)';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }

  console.log(
    pad('session', 26) +
    pad('calls', 7, true) +
    pad('input tokens', 14, true) +
    pad('output tokens', 15, true) +
    pad('cost (USD)', 12, true)
  );
  console.log('-'.repeat(74));

  const allRows = [...entries];
  for (const [sessionId, rows] of groups) {
    const inTok  = rows.reduce((s, e) => s + e.inputTokens, 0);
    const outTok = rows.reduce((s, e) => s + e.outputTokens, 0);
    console.log(
      pad(sessionId, 26) +
      pad(rows.length, 7, true) +
      pad(inTok.toLocaleString(), 14, true) +
      pad(outTok.toLocaleString(), 15, true) +
      pad(fmtCost(rows), 12, true)
    );
  }

  console.log('-'.repeat(74));
  const grandIn  = allRows.reduce((s, e) => s + e.inputTokens, 0);
  const grandOut = allRows.reduce((s, e) => s + e.outputTokens, 0);
  console.log(
    pad('total', 26) +
    pad(allRows.length, 7, true) +
    pad(grandIn.toLocaleString(), 14, true) +
    pad(grandOut.toLocaleString(), 15, true) +
    pad(fmtCost(allRows), 12, true)
  );
}
