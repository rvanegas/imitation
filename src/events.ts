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

export type GameEvent =
  // Lobby / lifecycle ---------------------------------------------------------
  | { kind: 'invite'; link: string }
  | {
      kind: 'gameStart';
      role: Role;
      phase: Phase;
      you: string;
      partner: string;
      score: ScoreInfo;
      restarted: boolean;
    }
  // Round phases --------------------------------------------------------------
  // To the witness: the judge's question. Witness moves to witness-answer.
  | { kind: 'question'; role: 'witness'; phase: 'witness-answer'; text: string; score: ScoreInfo }
  // To the judge: confirmation their question went out. Judge moves to judge-wait.
  // (Sent event-only, with empty fallback text, so text clients stay silent.)
  | { kind: 'questionSent'; role: 'judge'; phase: 'judge-wait'; text: string; score: ScoreInfo }
  // To the witness: their own reply plus the model's blind prediction, each
  // tagged with the A/B label the judge will see. Witness moves to witness-wait.
  | {
      kind: 'pair';
      role: 'witness';
      phase: 'witness-wait';
      yourText: string;
      yourLabel: Label;
      modelText: string;
      modelLabel: Label;
      score: ScoreInfo;
    }
  // To the judge: the two anonymous cards to choose between. Judge → judge-decide.
  | { kind: 'decide'; role: 'judge'; phase: 'judge-decide'; a: string; b: string; score: ScoreInfo }
  // To both players: the round result. `self` = this recipient made the call.
  | {
      kind: 'reveal';
      phase: 'reveal';
      correct: boolean;
      humanLabel: Label;   // which card was the real human
      aText: string;
      bText: string;
      call: Label;         // the judge's call
      self: boolean;       // did THIS recipient make the call?
      score: ScoreInfo;
      nextRole: Role;      // this recipient's role in the next round
    }
  // Ancillary -----------------------------------------------------------------
  | { kind: 'status'; role: Role | null; phase: Phase; score: ScoreInfo; players: string[]; judge: string; spectators: number }
  | { kind: 'leaderboard'; entries: LeaderboardEntry[] };

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
