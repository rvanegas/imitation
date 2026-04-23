# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev server              # Run server with Telegram bot
npm run dev server --no-telegram  # Run server without Telegram (socket only)
npm run dev server -t           # Same as --no-telegram
npm run dev terminal <name>     # Connect a named terminal client to the server
npm run build                   # Compile TypeScript to dist/
npm run start                   # Run compiled output from dist/
cd app && npx expo start        # Run Expo dev server (./app)
```

No test suite exists. There is no linter configured beyond TypeScript strict mode.

## Configuration

Requires `~/.config/imitation/config.toml` (see `config.toml.example`):
- `bot_token` — Telegram bot token (optional if running with `--no-telegram`)
- `model_provider` — `"anthropic"` (default) or `"ollama"`
- `[anthropic] api_key` — Anthropic API key
- `[anthropic] model` — model ID (default: `claude-sonnet-4-6`)
- `[ollama] model` / `[ollama] base_url` — Ollama settings
- `[socket] path` — override the Unix socket path

XDG directories are respected (`XDG_CONFIG_HOME`, `XDG_STATE_HOME`, `XDG_RUNTIME_DIR`).

`~/.local/state/imitation/user_profiles.json` — persists user message history across restarts.
`~/.local/state/imitation/sessions.json` — persists active sessions across restarts.
Unix socket defaults to `$XDG_RUNTIME_DIR/imitation/imitation.sock`.

## Architecture

This is a game implementing the Imitation Game (Turing Test). Two players exchange messages; after each exchange the AI generates what it predicts the witness would have written. The judge sees two options (A and B, one human, one AI) and calls which is human.

**Game flow:**
1. Player A sends `/start` → gets an invite token
2. Player B joins via token → game begins; Player A is the judge
3. Judge takes the first turn → `imitation.ts` generates a blind AI prediction of the witness's response
4. Witness responds → `delivery.ts` sends both to the judge (randomized A/B order)
5. Judge calls with `/human A` or `/human B` (or `/a`/`/b`)
6. Score updates, roles alternate via `session.ts`

**Key files:**
- `src/main.ts` — Entry point; dispatches to `server` or `terminal` subcommand
- `src/engine.ts` — All game logic handlers (`handleMessage`, `handleHuman`, `handleJoin`, etc.); transport-agnostic
- `src/transport.ts` — `Transport` interface (`send`, `makeInviteLink`)
- `src/server.ts` — Runs the Unix socket server + optional Telegram bot; `CombinedTransport` tries socket first, falls back to Telegram
- `src/bot.ts` — Telegraf bot setup; maps Telegram commands to `engine` handlers
- `src/terminal.ts` — Interactive single-process terminal UI (multi-user via `:as <name>` meta-command); used for local testing
- `src/client.ts` — Terminal client that connects to the socket server (for multi-process testing or real multi-user use)
- `src/imitation.ts` — Claude API calls: `generatePrediction` and `generateAssessment`
- `src/session.ts` — Session state, invite flow, persistence to `sessions.json`, 1-hour timeout
- `src/delivery.ts` — Routes messages to sender (shows their message + AI prediction), receiver (A/B choice), and spectators
- `src/userProfiles.ts` — Reads/writes `user_profiles.json`; stores prior messages per user pair for style calibration
- `src/types.ts` — Shared TypeScript interfaces (`GameSession`, `TranscriptEntry`, `MessagePair`, `UserProfile`)
- `src/log.ts` — Session logging
- `src/migrate.ts` — Data migration utility
- `src/userProfiles.ts` — **TODO:** remove `migrateFlat()` and its call in `loadStore()` once the new nested `user_profiles.json` format has been confirmed in production (auto-migration runs lazily on first server start after deploy)

**Key state in `GameSession`:**
- `imitationFirst` — randomized each round; determines whether A=AI/B=human or vice versa
- `pendingResponder` — `null`=judge's turn, `witnessId`=response phase
- `interrogator` — field name retained for data compatibility; holds the judge's UserId
- `pendingPrediction` / `pendingSystemPrompt` — stored between judge's message and witness response
- `teamScores` — humans vs. model scores

**Commands available in-game:**
`/start`, `/human A|B`, `/a`, `/b`, `/invite`, `/status`, `/stop`, `/leave`, `/restart <u1> <u2>`, `/setname <name>`, `/help`

**AI prediction prompt (in `imitation.ts`):** Instructs Claude to impersonate the human sender using their prior messages as style examples. The prompt explicitly handles opening moves, consecutive turns (interruptions), spelling/grammar matching, and forbids Claude from identifying itself as AI. After each round, `generateAssessment` is called asynchronously to analyze prediction quality and store results via `appendAssessment`.
