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
