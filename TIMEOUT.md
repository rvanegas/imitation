# Session Timeout Mechanism

Sessions time out after 1 hour of inactivity. This document explains how that is implemented, and why it is designed the way it is.

## Core invariant

A session ends when `lastActivity` has not been updated for at least `SESSION_TIMEOUT_MS` (1 hour). The `lastActivity` timestamp is the single source of truth. Timer handles are an implementation detail, not the decision-making mechanism.

## What counts as activity

`touchSession(s)` stamps `s.lastActivity = Date.now()` and persists the session. It is called from `engine.ts` at every point where a player makes a valid game move:

- A message is sent and accepted for prediction (interrogator asking, or sender in symmetric mode)
- A response is accepted and the A/B options are delivered
- A `/human` guess is submitted

Commands that are rejected (wrong turn, invalid format) do not update `lastActivity`.

## How the timer works

`scheduleTimeout(s)` sets a `setTimeout` for the time remaining until the session would have been idle for 1 hour:

```
remaining = SESSION_TIMEOUT_MS - (Date.now() - s.lastActivity)
```

When the timer fires, it re-reads `s.lastActivity` at that moment:

- If `idle >= SESSION_TIMEOUT_MS`: the session has genuinely been inactive, so call `timeoutCallback` to notify players and end the session.
- If `idle < SESSION_TIMEOUT_MS`: activity happened after the timer was scheduled. Reschedule for the new remaining time.

The check at fire time, not at scheduling time, is what makes this correct.

## Why the naive approach was wrong

The previous implementation used `clearTimeout` + `setTimeout` inside `touchSession` to reset the timer on every activity. The intent was: whenever activity happens, cancel the old timer and start a fresh 1-hour countdown.

This has a race condition specific to Node.js async execution:

1. A timer set at time T fires at T+1h. Node.js invokes the callback, which is an `async` function.
2. The callback sends a Telegram message (`await transport.send(...)`). At this `await` it suspends and yields the event loop.
3. While it is suspended, an incoming message arrives. The message handler runs, activity is recorded, and `touchSession` calls `clearTimeout(s.timeoutHandle)`.
4. But the timer has already fired — it is no longer in the pending-timers list. `clearTimeout` on an already-fired timer is a no-op.
5. The event loop resumes the suspended `onTimeout` callback. It ends the session even though activity just occurred.

The fix: do not rely on `clearTimeout` to prevent the timeout. Instead, check `lastActivity` inside the callback at the moment it runs. If activity happened since the timer was scheduled, the check fails and the timer simply reschedules itself.

## Lifecycle

```
acceptInvite()
  └─ scheduleTimeout(s)          ← timer starts at session creation

touchSession(s)                  ← called on every valid game move
  └─ s.lastActivity = Date.now() ← timer is NOT reset here

timer fires
  ├─ idle >= 1h → timeoutCallback(s) → endSession(s)
  └─ idle < 1h  → scheduleTimeout(s) ← reschedule for remaining time

restartWithPlayers()
  └─ clearTimeout + scheduleTimeout  ← explicit reset on restart

loadPersistedSessions()
  ├─ elapsed >= 1h → skip (already expired, do not restore)
  └─ elapsed <  1h → scheduleTimeout(s) ← restore with remaining time
```

## Persistence across restarts

`timeoutHandle` is not serialized (it is a Node.js internal handle). On restart, `loadPersistedSessions` reads `lastActivity` from `sessions.json`. If `Date.now() - lastActivity >= SESSION_TIMEOUT_MS`, the session is treated as already expired and is silently dropped. Otherwise it is restored and `scheduleTimeout` is called with the remaining time.

## The timeout callback

`setTimeoutCallback` registers a single async function that handles all session timeouts. It is set once during `initSessions` in `engine.ts` with a closure over the `Transport` instance, so it can send Telegram messages. It calls `endSession` after notifying both players.

There is no per-session callback reference. All sessions share the same callback registered at startup.
