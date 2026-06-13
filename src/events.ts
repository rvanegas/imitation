// Structured game-event protocol for rich clients (the iOS/Expo app).
//
// Every event is delivered alongside a plain-text fallback via Transport.send().
// Text-only transports (Telegram, terminal, raw socket) ignore the event and
// render the fallback; the WebSocket transport forwards the event to the app so
// it can drive a role- and phase-aware UI instead of parsing chat text.
//
// Keep this file dependency-light: it is imported by both the server (src/) and,
// by hand-mirroring, the app (app/src/ws.ts). When you change an event shape,
// update both sides.

import { GameSession } from './types';

export type Role = 'judge' | 'witness';
export type Label = 'A' | 'B';

// Per-recipient phase of the round. Describes what THIS player should be doing
// or seeing right now — the app maps each phase to a screen.
export type Phase =
  | 'lobby'           // no active round (waiting for partner / between games)
  | 'judge-ask'       // you are the judge: compose the opening message
  | 'judge-wait'      // you are the judge: your question is sent, awaiting the reply
  | 'judge-decide'    // you are the judge: two cards are in, call which is human
  | 'witness-wait'    // you are the witness: awaiting the judge's question / verdict
  | 'witness-answer'  // you are the witness: compose your reply
  | 'reveal';         // verdict is in for the round just played

// Numeric score snapshot. Mirrors the human-readable line the text clients show,
// but pre-computed so the app never parses percentages out of a string.
export interface ScoreInfo {
  humans: number;      // raw rounds won by the human team
  model: number;       // raw rounds won by the model
  humanPct: number;    // -100..100, 0 = chance (humans h/total*200-100)
  modelPct: number;    // 0..200-ish, 0 = humans perfect, 100 = chance
  streak: number;      // current human win streak
  bestStreak: number;  // longest human win streak this session
  round: number;       // rounds completed
  avgTurns: number | null; // mean Q&A exchanges per round, null before any round
}

export interface LeaderboardEntry {
  rank: number;
  name: string;
  wins: number;
  losses: number;
  pct: number;
  bestStreak: number;
}

// A present participant in a session. `seated` = currently holds a player slot
// (vs. a spectator). Used to drive the in-app restart picker.
export interface RosterEntry {
  name: string;
  seated: boolean;
}

// One question/answer exchange in the current round, reconstructed from the
// transcript. `a`/`b` are the two anonymous cards (only once the witness has
// answered); the witness additionally learns which side was theirs.
export interface SyncExchange {
  question: string;
  a?: string;
  b?: string;
  yourLabel?: Label;   // witness only
  modelLabel?: Label;  // witness only
}

// The result of the round that just ended (present only in the reveal phase).
export interface RevealInfo {
  correct: boolean;
  humanLabel: Label;
  aText: string;
  bText: string;
  call: Label;
  self: boolean;       // did THIS recipient make the call?
  nextRole: Role;      // this recipient's role in the next round
}

export type GameEvent =
  | { kind: 'invite'; link: string }
  | { kind: 'leaderboard'; entries: LeaderboardEntry[] }
  // The authoritative snapshot. The app REPLACES its view with this — it is a
  // pure function of the recorded transcript, so replaying it (on every change,
  // on reconnect, repeatedly) always converges to the same screen. No deltas to
  // drop or double up.
  | {
      kind: 'sync';
      role: Role | null;
      phase: Phase;
      score: ScoreInfo;
      you: string;
      partner: string;
      exchanges: SyncExchange[];  // the current round's full Q&A thread
      roster: RosterEntry[];
      waiting: boolean;           // an empty player seat → app shows restart picker
      reveal: RevealInfo | null;  // set only in the reveal phase
    };

// --- Builders ---------------------------------------------------------------

export function buildScore(s: GameSession): ScoreInfo {
  const h = s.teamScores.humans;
  const m = s.teamScores.model;
  const total = h + m;
  return {
    humans: h,
    model: m,
    humanPct: total === 0 ? 0 : Math.round((h / total) * 200 - 100),
    modelPct: total === 0 ? 0 : Math.round((m / total) * 200),
    streak: s.winStreak ?? 0,
    bestStreak: s.longestWinStreak ?? 0,
    round: s.roundCount,
    avgTurns: s.roundCount > 0 ? Number((s.totalTurns / s.roundCount).toFixed(1)) : null,
  };
}
