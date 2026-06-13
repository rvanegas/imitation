// Derives a phase-aware game model from the server's structured event stream.
// The app renders THIS state — it never parses chat text to figure out whose
// turn it is. See src/events.ts on the server for the event shapes.

import {
  ServerMessage, GameEvent, Role, Phase, Label, ScoreInfo, LeaderboardEntry, RosterEntry,
} from './ws';

// One question/answer round-trip within a round. A round may contain several:
// the judge can keep probing before calling. `a`/`b` hold the two anonymous
// answers (stable A/B identity for the whole round); the witness additionally
// knows which side was theirs.
export interface Exchange {
  question: string;
  a?: string;
  b?: string;
  yourLabel?: Label;   // witness only: which card was their real answer
  modelLabel?: Label;  // witness only: which card was the model's imitation
}

export interface RevealData {
  correct: boolean;
  humanLabel: Label;
  aText: string;
  bText: string;
  call: Label;
  self: boolean;
  nextRole: Role;
}

export interface GameState {
  status: 'lobby' | 'playing';
  role: Role | null;
  phase: Phase;
  score: ScoreInfo | null;
  you: string;
  partner: string;
  exchanges: Exchange[];      // this round's Q&A thread
  inviteLink: string | null;
  leaderboard: LeaderboardEntry[] | null;
  reveal: RevealData | null;
  notice: string | null;      // transient banner (errors, rejections)
  roster: RosterEntry[];      // present participants (for the restart picker)
  waiting: boolean;           // session has an empty player seat
}

export const initialState: GameState = {
  status: 'lobby',
  role: null,
  phase: 'lobby',
  score: null,
  you: '',
  partner: '',
  exchanges: [],
  inviteLink: null,
  leaderboard: null,
  reveal: null,
  notice: null,
  roster: [],
  waiting: false,
};

export type Action =
  | { kind: 'server'; msg: ServerMessage }
  | { kind: 'continue' }   // dismiss the reveal, advance to the next round
  | { kind: 'reset' };     // sign out / fresh login

// Plain `msg` frames the new UI already conveys (or that reference the old
// slash-command flow). We drop these rather than show them as banners.
function isNoise(text: string): boolean {
  return (
    text.includes('Show this message') ||      // /help text
    text.startsWith('/start —') ||
    text.includes('You can still use /status') || // out-of-turn waiting prompts
    text.startsWith('Game started') ||          // covered by gameStart event
    text.startsWith('Game restarted')
  );
}

function reduceEvent(state: GameState, ev: GameEvent): GameState {
  switch (ev.kind) {
    case 'invite':
      return { ...state, inviteLink: ev.link };

    case 'leaderboard':
      return { ...state, leaderboard: ev.entries };

    // The authoritative snapshot: replace the whole view. Because it's rebuilt
    // from the recorded transcript, replaying it (live, on reconnect, repeatedly)
    // always converges to the same screen — no accumulation, no duplication.
    case 'sync': {
      const playing = !ev.waiting && ev.role !== null;
      return {
        ...state,
        status: playing ? 'playing' : 'lobby',
        role: ev.role,
        phase: ev.phase,
        score: ev.score,
        you: ev.you,
        partner: ev.partner,
        exchanges: ev.exchanges,
        roster: ev.roster,
        waiting: ev.waiting,
        reveal: ev.reveal,
      };
    }

    default:
      return state;
  }
}

export function reduce(state: GameState, action: Action): GameState {
  switch (action.kind) {
    case 'reset':
      return initialState;

    case 'continue': {
      const r = state.reveal;
      if (!r) return state;
      return {
        ...state,
        role: r.nextRole,
        phase: r.nextRole === 'judge' ? 'judge-ask' : 'witness-wait',
        exchanges: [],
        reveal: null,
        notice: null,
      };
    }

    case 'server': {
      const msg = action.msg;
      if (msg.type === 'event') return reduceEvent(state, msg.event);
      if (msg.type === 'error') return { ...state, notice: msg.text };
      if (msg.type === 'msg') return isNoise(msg.text) ? state : { ...state, notice: msg.text };
      return state;
    }
  }
}

// The round number to display: completed rounds + the one in progress.
export function displayRound(state: GameState): number {
  return (state.score?.round ?? 0) + 1;
}
