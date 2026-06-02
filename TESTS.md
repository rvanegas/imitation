# Tests & Experiment Harness

## Unit / Integration Tests (Vitest)

Run with `npm test`. No Anthropic API calls — all AI functions are stubbed. Completes in under a second.

```bash
npm test                # run once
npm run test:watch      # watch mode
npm run test:coverage   # with coverage report
```

### File structure

```
vitest.config.ts
tests/
  helpers/
    MockTransport.ts    — captures send() calls per userId
    gameHelpers.ts      — startGame(), playRound(), nextUid() helpers
    setup.ts            — beforeEach: wipes sessions.json & user_profiles.json
  engine.test.ts        — core game flow (13 tests)
  edgeCases.test.ts     — spectators, leave, restart, setname guards (8 tests)
  delivery.test.ts      — A/B ordering, spectator delivery, failed-spectator pruning (4 tests)
```

### Key design choices

- `pool: 'forks'` with `fileParallelism: false` — each test file gets its own Node.js process for module isolation; sequential to avoid shared-temp-dir races between concurrent workers
- AI functions mocked via `vi.mock('../../src/imitation', ...)` hoisted above imports — intercepts at module load time without touching `src/`
- UIDs start at 10000 and increment — avoids collisions with any real state; `beforeEach` wipes the XDG state files so profiles/sessions start fresh each test
- `imitationFirst` forced deterministically in tests that assert specific A/B label order

---

## Context Experiment Harness

Makes **real Anthropic API calls**. Produces tabular token-usage data; no pass/fail verdict. Use to answer questions about cache efficiency, context growth, and compaction behavior.

```bash
npm run experiment context-growth    # 10-round fresh-user game; shows per-round token growth
npm run experiment cache-efficiency  # two successive 5-round games; compares cache hit rates
npm run experiment compaction        # 25 rounds; shows context shrink after compaction fires at round 20
npm run experiment profile-richness  # 0/10/50 seed messages; compares cached block size
```

### File structure

```
experiments/
  run.ts                     — dispatcher; invoked via src/main.ts experiment <name>
  ScriptedTransport.ts       — Transport that captures output; game driven by direct handler calls
  TokenLedger.ts             — reads cost-audit.jsonl filtered by sessionId, prints per-round table
  scenarios/
    context-growth.ts
    cache-efficiency.ts
    compaction.ts
    profile-richness.ts
```

### Sample output (context-growth)

```
Round  Op             Input   Output  CacheCreate  CacheRead  CacheHit%
  1    prediction      1240      42          980          0        0%
  2    prediction      1380      38            0        980       71%
  3    prediction      1520      55            0        980       64%
  ...
```

Uncached input grows each round as `deltaMessages` accumulate; cached base stays constant after round 1.
