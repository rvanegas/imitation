# Test & Experiment Harness

## Part 1: Unit / Integration Tests (Vitest)

### Purpose

Automated tests that verify game state transitions without manual interaction. No Anthropic API calls — all AI functions are stubbed. Fast feedback during development.

### Dependencies to Install

```bash
npm install --save-dev vitest @vitest/coverage-v8
```

### File Structure

```
vitest.config.ts
tests/
  helpers/
    MockTransport.ts      — captures send() calls per userId
    gameHelpers.ts        — startGame(), playRound() scenario helpers
    setup.ts              — beforeEach: wipes sessions.json & user_profiles.json
  engine.test.ts          — core game flow
  edgeCases.test.ts       — spectators, leave, restart, guards
  delivery.test.ts        — A/B ordering, spectator delivery (unit)
```

No `src/` files are modified.

### Key Challenges

**`config.ts` side effects** — reads XDG env vars and creates directories at import time. Solved by setting `XDG_STATE_HOME`, `XDG_CONFIG_HOME`, `XDG_RUNTIME_DIR` in `vitest.config.ts`'s `env` block before any worker imports run. Missing TOML silently falls back to empty defaults.

**AI calls not injected** — `engine.ts` imports `generatePrediction` etc. directly from `imitation.ts`. Vitest hoists `vi.mock()` above imports, intercepting at module load time.

**Session state is global** — `session.ts` has a module-level `Map`. Tests use unique incrementing user IDs (starting at 10000) so sessions from different tests don't collide within a file.

### vitest.config.ts

```typescript
import { defineConfig } from 'vitest/config';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

const testStateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'imitation-test-'));

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    pool: 'forks',
    env: {
      XDG_STATE_HOME: testStateDir,
      XDG_CONFIG_HOME: testStateDir,
      XDG_RUNTIME_DIR: testStateDir,
    },
    setupFiles: ['./tests/helpers/setup.ts'],
    include: ['tests/**/*.test.ts'],
  },
});
```

`pool: 'forks'` gives file-level module isolation — each test file gets its own process, preventing session state leakage between files.

### MockTransport

Implements `Transport` (`src/transport.ts`):
- `send(userId, text)` — appends to a `Map<UserId, string[]>`
- `makeInviteLink(token)` — returns `test://join/<token>`
- `getMessages(userId)`, `lastMessage(userId)`, `findMessage(pred)` — query helpers
- `clear()` — reset between phases within a test
- `static tokenFromLink(link)` — extract token from invite link

### gameHelpers.ts

```typescript
let uidCounter = 10000;
export function nextUid() { return uidCounter++; }

// Calls handleStart(uid1), extracts token, calls handleJoin(uid2, token)
export async function startGame(): Promise<{ transport, uid1, uid2, token }>

// Reads session to find current judge/witness, then:
//   handleMessage(judge, judgeMsg) → handleMessage(witness, witnessMsg) → handleHuman(judge, call)
export async function playRound(setup, judgeMsg, witnessMsg, call: 'A'|'B')
```

### setup.ts

```typescript
import { SESSIONS_FILE, PROFILES_FILE } from '../../src/config';
beforeEach(() => {
  try { fs.unlinkSync(SESSIONS_FILE); } catch {}
  try { fs.unlinkSync(PROFILES_FILE); } catch {}
});
```

### Imitation mock (top of each test file)

Vitest hoists `vi.mock()` above all imports automatically:

```typescript
vi.mock('../../src/imitation', () => ({
  generatePrediction: vi.fn().mockResolvedValue({ text: 'mock prediction', systemPrompt: 'mock prompt' }),
  generateAssessment: vi.fn().mockResolvedValue('mock assessment'),
  checkMessageFairness: vi.fn().mockResolvedValue({ fair: true, reason: '' }),
  buildCachedBlock: vi.fn().mockReturnValue([{ text: 'mock cached block', cache: true }]),
  compactWitnessAssessments: vi.fn().mockResolvedValue('mock compacted'),
}));
import * as engine from '../../src/engine';
```

Exports mocked (all from `src/imitation.ts`):
- `buildCachedBlock(players, assessments)` → `SystemPromptBlock[]`
- `generatePrediction(...)` → `Promise<{ text: string; systemPrompt: string }>`
- `generateAssessment(...)` → `Promise<string>`
- `compactWitnessAssessments(...)` → `Promise<string>`
- `checkMessageFairness(message, sessionId?)` → `Promise<{ fair: boolean; reason: string }>`

### Handling `imitationFirst` Randomness

After `startGame()`, force a deterministic value for tests that assert specific A/B ordering:

```typescript
const s = sessionMod.getSessionForParticipant(uid1)!;
s.imitationFirst = true;
```

### Test Scenarios

**engine.test.ts** (core flow):
1. Invite flow — handleStart sends token; joining own token is rejected; valid join starts game for both players
2. Judge's turn — handleMessage sets `pendingResponder`; `generatePrediction` called; wrong-turn message is blocked
3. Witness response — A/B pair delivered to judge; `imitationFirst` determines label order
4. Judge call + scoring — correct call → humans+1; wrong call → model+1; roles swap after round
5. Multi-round — 3 rounds → `roundCount === 3`, scores accumulate, `interrogator` alternates

**edgeCases.test.ts**:
- Spectator join, receive, and `/human` rejection
- Player leave (partner notified; session ends)
- `/restart <u1> <u2>` resets scores and transcript
- `/setname` validation (leading digit, duplicate, reserved name)

**delivery.test.ts** (pure function, no engine):
- `deliverToReceiver` with `imitationFirst=true` → A=prediction, B=human
- `deliverToReceiver` with `imitationFirst=false` → A=human, B=prediction
- `deliverToSpectators` sends both sides with labels
- Failed spectator send removes them from the session

### package.json Scripts

```json
"test": "vitest run",
"test:watch": "vitest",
"test:coverage": "vitest run --coverage"
```

---

## Part 2: Context Experiment Harness

### Purpose

A manually-run harness that makes **real Anthropic API calls** to explore how context is managed over many rounds. Not pass/fail — produces tabular data about token usage, cache efficiency, and context growth. Used to answer questions like:

- How fast do input tokens grow as `deltaMessages` and `deltaAssessments` accumulate?
- Are cache reads displacing re-sent tokens as expected?
- When compaction fires (after 20+ assessments), how much does context shrink?
- How many prior profile messages meaningfully change the cached block size?

### Background: How Context is Layered

Each API call to `generatePrediction` sends:
1. **Cached block** (`cachedSystemPromptBlock`) — built once at `initGameCache()` from baseline profile messages and assessments; stays constant for the whole game; has `cache_control: ephemeral`
2. **Delta blocks** (uncached) — role designation + messages added this game (`deltaMessages`) + assessments added this game (`deltaAssessments`) + task context; grows each round

`cost-audit.jsonl` records `inputTokens`, `outputTokens`, `cacheCreationTokens`, and `cacheReadTokens` for every API call, tagged with `sessionId` and `operation`.

### File Structure

```
experiments/
  run.ts                  — entry point, dispatches to named scenario
  ScriptedTransport.ts    — Transport that captures messages; game driven by direct handler calls
  TokenLedger.ts          — reads cost-audit.jsonl filtered by sessionId, prints per-round table
  scenarios/
    context-growth.ts     — N-round game, fresh users; shows token growth per round
    cache-efficiency.ts   — two successive games, same users; compares cache hit rates
    compaction.ts         — 25+ rounds; shows context size before and after compaction fires
    profile-richness.ts   — seeds profiles with 0/10/50 messages; compares first-game context
```

Hooked into `main.ts` as a new `experiment` subcommand (dev-only; not part of the production server).

### ScriptedTransport

Implements `Transport`. Buffers all `send()` calls in a `Map<UserId, string[]>`. `makeInviteLink` returns a deterministic string. Scenarios drive the game directly via engine handler calls — no reactive message loop needed. The transport is only there to satisfy the interface and capture output for inspection.

### TokenLedger

```typescript
class TokenLedger {
  constructor(sessionId: string, auditFile: string)

  // Read cost-audit.jsonl, filter to this sessionId, group by guessNumber
  readAll(): RoundStats[]

  // Print a table: round | operation | input | output | cacheCreate | cacheRead | hitPct
  printSummary(): void
}
```

Filters by `sessionId` so experiment runs don't pick up audit entries from other sessions or manual play.

### Scenario: `context-growth`

Run a 10-round game between two fresh users with no prior profile history. After each round, print:

```
Round  Op          Input   Output  CacheCreate  CacheRead  CacheHit%
  1    prediction   1240      42        980          0         0%
  2    prediction   1380      38          0        980        71%
  3    prediction   1520      55          0        980        64%
  ...
```

Shows: uncached input (`Input - CacheRead`) grows each round as deltaMessages accumulate; cached base stays constant.

### Scenario: `cache-efficiency`

Run two successive 5-round games with the same two users. Compare:
- Game 1 round 1: `cacheCreationTokens` high (first write), `cacheReadTokens` = 0
- Game 1 rounds 2–5: `cacheReadTokens` rising (in-game cache warming)
- Game 2 round 1: new `initGameCache()` call — larger cached block (more profile history), `cacheReadTokens` = 0 again
- Game 2 rounds 2–5: cache warms again on the new larger block

Tests whether `ensureGameCache` + baseline counting correctly re-establishes caching across games.

### Scenario: `compaction`

Run 25 rounds against one witness. `maybeCompactWitness` fires after round 20 (threshold = 20 assessments). Show:
- Rounds 1–20: delta assessment section grows by one entry per round
- Round 21+: delta shrinks dramatically (all 20+ assessments merged into 1 compacted entry)
- Compare total input tokens pre- and post-compaction

### Scenario: `profile-richness`

Seed `user_profiles.json` with 0, 10, and 50 prior messages for the witness. Run a 1-round game each time. Compare:
- Cached block token count (grows with profile size)
- `cacheCreationTokens` on round 1 (how much is being cached)
- Whether richer profiles meaningfully change the delta or only the cached block

### New npm Script

```json
"experiment": "ts-node src/main.ts experiment"
```

Run as: `npm run experiment context-growth`, `npm run experiment compaction`, etc.

### Comparison: Tests vs Experiments

|                  | Unit Tests (Vitest)          | Experiments                        |
|------------------|------------------------------|------------------------------------|
| AI calls         | Mocked                       | Real (Anthropic API)               |
| Pass/fail        | Yes                          | No — produces data                 |
| Speed            | Fast (~seconds)              | Slow (API latency × rounds)        |
| Cost             | Zero                         | Real API cost                      |
| Purpose          | Correctness                  | Exploration                        |
| Run via          | `npm test`                   | `npm run experiment <name>`        |
| State directory  | Temp isolated dir            | Real `~/.local/state/imitation/`   |
