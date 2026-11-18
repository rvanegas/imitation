# Imitation

**A faithful implementation of Turing's Imitation Game**
TypeScript · Node.js · Anthropic API · React Native (iOS)

---

## What it is

Imitation is a multi-player implementation of the Turing test as Alan Turing originally described it in his 1950 paper "Computing Machinery and Intelligence." Two users are paired: one human plays themselves, the other is replaced by a language model attempting to imitate a human. A judge exchanges messages with both and must determine which is the human.

Most so-called "Turing tests" deviate significantly from Turing's original design. Imitation is faithful to the source: the teletype format, the imitation framing (not "who is smarter" but "who is human"), and the adversarial dynamic in which the model must actively deceive while the human may actively assist the judge in identifying them.

---

## Why it exists

Imitation exists as both a research instrument and a philosophical demonstration. The question of whether a language model can pass for human in open-ended conversation is not primarily a question about intelligence — it is a question about the nature of imitation, the reliability of behavioral evidence, and what we actually mean when we attribute understanding to another mind.

Running games and studying the transcripts produces observations about where current models succeed and fail at human imitation that are not available from standard benchmarks.

---

## How to play

The server runs on the commons box, with the Telegram bot in the same process, so there is nothing to start. A game is two players; each can be on Telegram or in a terminal, in any mix.

**Starting a game.** Whoever sends `/start` creates the game and is the judge. The reply is an invite: a `https://t.me/<bot>?start=<token>` link, and an `imitation://join/<token>` line for the iPhone app. Send it to the other player. The first to join becomes the witness; anyone joining after watches.

**On Telegram**, DM the bot. To start, send `/start`; to join, tap the invite's `t.me` link.

**In a terminal**, from this checkout:

```bash
npm run dev terminal [name]
```

It plays on the deployed server (`wss://imitation.rvanegas.co/ws`). The first run on a machine asks for a link code: send `/link` to the bot on Telegram and type the code it replies with at the `link code>` prompt. The bot's reply says to enter it in the iPhone app; the terminal takes it too. A code works once and expires after ten minutes. The token that comes back is kept in `terminal-tokens.json`, so later runs sign straight in. Then `/start` starts a game, and `/start <token>` joins one, with the token from the invite.

**Linking makes the terminal that Telegram account.** Two players linked to the same account are one player, and the server refuses a player's own invite. The terminal player links a different Telegram account from the one the other player is on.

**In a game**, the judge writes first and receives two replies, A and B, one from the witness and one from the model; `/a` or `/b` (or `/human A|B`) calls which is human. `/status`, `/invite`, `/leave` and `/help` work from either side.

---

## Architecture

**Transport layer**: Three transport implementations with priority-based fallback — Telegram bot API, WebSocket server, and Unix socket. The same game logic runs over any of them. A React Native iOS client provides a native mobile interface.

**Prompt caching**: Session-static content (player history, accumulated assessments) is placed in cached prompt blocks. Per-call dynamic content (current message, game state) is placed in delta blocks. This split significantly reduces token costs across multi-round games without sacrificing context fidelity.

**Game integrity**: The model generates its prediction of which player it is imitating before the witness responds to each judge message. This blind prediction is recorded and used in post-game assessment, preserving the integrity of the evaluation.

**Fairness filter**: Judge messages are routed through a secondary model to detect questions that exploit specifically AI-versus-human knowledge gaps (e.g., "what does it feel like to be tired?"). Flagged questions are handled separately to keep the game focused on conversational imitation rather than trivia about embodied experience.

**Self-improvement**: After each game, a structured assessment is generated covering the model's successes and failures. These assessments accumulate in the player's profile and are fed back into the system prompt for subsequent games, creating a learning loop within the session history.

---

## What it demonstrates

- Multi-transport architecture with clean separation between game logic and delivery mechanism
- Cost-aware prompt caching strategy for multi-turn applications
- Self-improving agent design using accumulated structured assessments
- A philosophically motivated application that takes the original Turing paper seriously as a design document

---

## Background

The name "Imitation" is taken directly from Turing's own framing: he called it the Imitation Game, not the Intelligence Test. The distinction matters — Turing was asking whether a machine could imitate human behavior well enough to be indistinguishable, not whether it could surpass human intelligence.
