# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Run with ts-node (no build needed)
npm run build    # Compile TypeScript to dist/
npm run start    # Run compiled output from dist/
```

No test suite exists. There is no linter configured beyond TypeScript strict mode.

## Environment

Requires a `.env` file (see `.env.example`):
- `BOT_TOKEN` — Telegram bot token
- `ANTHROPIC_API_KEY` — Anthropic API key

`user_profiles.json` is generated at runtime and persists user message history across restarts.

## Architecture

This is a Telegram bot implementing an Imitation Game (Turing Test). Two players chat, and after each message the AI generates what it predicts the sender would have written. The receiver sees two options (A and B, one human, one AI) and guesses which is human.

**Game flow:**
1. Player A sends `/start` → gets an invite link
2. Player B joins via link → game begins
3. Sender writes a message → `imitation.ts` generates a blind AI prediction of that message
4. `delivery.ts` sends both versions to the receiver (randomized A/B order)
5. Receiver guesses with `/human A` or `/human B`
6. Score updates, roles reshuffle via `session.ts`

**Key files:**
- `src/bot.ts` — All Telegram command handlers (`/start`, `/invite`, `/stop`, `/human`) and message routing
- `src/imitation.ts` — Claude API call that generates predictions; builds a system prompt using prior messages as style samples
- `src/session.ts` — In-memory session state (lost on restart), invite flow, spectator tokens, 1-hour timeout
- `src/delivery.ts` — Routes messages to sender (shows their message + AI prediction), receiver (shows A/B choice), and spectators
- `src/userProfiles.ts` — Reads/writes `user_profiles.json`; stores up to 1MB of prior messages per user pair for style calibration
- `src/types.ts` — Shared TypeScript interfaces (`GameSession`, `TranscriptEntry`, `MessagePair`, `UserProfile`)

**Key state in `GameSession`:**
- `imitationFirst` — randomized each round; determines whether A=AI/B=human or vice versa
- `pendingResponder` — whose turn it is to respond
- `firstSender` — alternates each round for fair play
- `spectators` — array of chat IDs watching read-only

**AI prediction prompt (in `imitation.ts`):** Instructs Claude to impersonate the human sender using their prior messages as style examples. The prompt explicitly handles opening moves, consecutive turns (interruptions), spelling/grammar matching, and forbids Claude from identifying itself as AI.
