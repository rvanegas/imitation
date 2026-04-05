# System Audit

## Session state (`sessions.json`)

One entry per active session. Persisted fields (excluded: `timeoutHandle`, `lastSystemPrompt`):

```
id                  string          6-char token, e.g. "ue52so"
user1               number          Telegram ID of initiator
user2               number          Telegram ID of joiner
status              "active"
variation           "symmetric" | "original"
imitationFirst      boolean         randomized each round; true → A=model, B=human
transcript          TranscriptEntry[]
pendingResponder    number | null   symmetric: who must guess; original: null=interrogator's turn, witnessId=answer phase
firstSender         number          symmetric: who sends first this round
interrogator        number          original: who is asking/guessing this round
pendingPrediction   string | null   original: cached AI prediction between question and answer
pendingSystemPrompt string | null   original: system prompt paired with pendingPrediction (survives restart)
scores              { user1, user2 }
teamScores          { humans, model }  original only
currentRoundTurns   number          original: Q&A exchanges in current round
totalTurns          number          original: cumulative
roundCount          number          original: completed rounds
spectators          number[]
lastActivity        number          unix ms timestamp
```

Each `TranscriptEntry`:
```
role     "user1" | "user2" | "model" | "guess"
content  string
correct  boolean           only when role === "guess"
guesser  "user1" | "user2" only when role === "guess"
```

---

## user_profiles.json

Three kinds of keys:

**User messages** — keyed `"userId:partnerId"`, one entry per ordered pair:
```json
{
  "861492596:121141043": {
    "messages": ["Hello", "How have you been?"]
  }
}
```
Written by `appendMessage(userId, partnerId, text)` on every message sent. Capped at 1MB per pair (oldest evicted). Written for: the sender in symmetric; the interrogator on question, the witness on answer in original.

**User names** — keyed `"userId"`:
```json
{
  "861492596": { "messages": [], "name": "Rodrigo" }
}
```
Written by `setName` (`/setname`) and `getOrAssignName` (on first join). Also `"__counter": N` for auto-name sequencing.

**Assessments** — keyed `"__assessments"`:
```json
{
  "__assessments": {
    "list": [
      {
        "text": "The imitation was too verbose...",
        "sessionId": "ue52so",
        "guessNumber": 3,
        "guesserId": 861492596,
        "imitateeId": 121141043,
        "correct": true,
        "timestamp": "2026-04-04T21:00:00.000Z"
      }
    ]
  }
}
```
`imitateeId === 0` means general/compacted. Written after every guess.

---

## Log file (`logs/session-{id}.txt`)

Rewritten in full on every `saveState`, finalized on `/stop` or timeout.

```
Session: ue52so
Variation: original
User 1: 121141043
User 2: 1782037769
[Ended: 2026-04-04T21:17:02.383Z]     ← only on session end

--- System Prompt ---

{lastSystemPrompt ?? "(not yet generated)"}

--- Transcript (as sent to model) ---
[861492596]: Hello
[121141043]: Hola
[121141043 imitation]: Hi
[861492596 guessed: A (A was the human, B was the model.) — CORRECT]
```

Note: the log transcript uses bare `[userId]` labels, **not** `[userId (name)]`. The heading says "as sent to model" but the format differs from what is actually sent (see below).

---

## LLM calls

### Prediction (`generatePrediction`)

**System prompt** (`buildSystemPrompt`):
```
# Rules
You are playing the imitation game...
[Turing test framing + 4 rules]

# Players
Interrogator: 1782037769 (Just)
Witness (being imitated): 121141043 (Roxanne)

# Past messages

The following are real messages each user has sent in previous sessions...
[style calibration instructions]

## 1782037769 (Just)
  1. Properties are the essential to identity
  2. hola!
  ...

## 121141043 (Roxanne)
  1. Hey dear.😉
  2. How is life?
  ...

# Assessments                          ← omitted if none
- [general] The imitation was too literal...
- [for Roxanne] The human's responses were terse...

# Task context                         ← only for opener or self-follow
The conversation has not started yet...
```

**User message**:
```
Conversation so far:
[1782037769 (Just)]: when you have time just read the Turing paper?
[121141043 (Roxanne) imitation]: I will!
[121141043 (Roxanne)]: I Know nothing.
...

What would [121141043 (Roxanne)] say next?
```
or, in original variation:
```
The interrogator just asked: "what do you believe in?"

What would [121141043 (Roxanne)] say in response?
```

Guess entries are skipped entirely from the conversation history sent to the model.

---

### Assessment (`generateAssessment`)

Triggered after every guess, fire-and-forget.

**System prompt**:
```
You are reflecting on an imitation attempt in a Turing Test.
The user you were imitating has Telegram ID 121141043.
Write your lesson in abstract style terms so it can be applied
when imitating this specific user in the future.
```

**User message**:
```
You just attempted to imitate a human in a Turing Test.

Conversation context available during prediction:
[User 1]: when you have time just read the Turing paper?
[User 2 imitation]: I will!
[User 2]: I Know nothing.

The human actually wrote: "I Know nothing."
Your imitation was: "Sure, why not."

The human correctly identified the AI — the imitation did not fool them.

In 2-3 sentences, assess what worked or didn't work...
```

Note: the assessment prompt uses generic `[User 1]`/`[User 2]` labels, not IDs or names.

---

## Inconsistencies

- The log's `--- Transcript (as sent to model) ---` uses `[userId]` labels, but `generatePrediction` sends `[userId (name)]` labels. The heading is misleading.
- The assessment prompt uses `[User 1]`/`[User 2]` labels rather than IDs or names, inconsistent with everything else.
