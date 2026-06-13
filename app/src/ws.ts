// WebSocket client for the imitation server.
// All messages are JSON frames (no newline framing needed over WebSocket).

import Constants from 'expo-constants';
export const SERVER_URL: string =
  (Constants.expoConfig?.extra?.serverUrl as string | undefined) ?? 'ws://localhost:8080';
// export const SERVER_URL = 'ws://192.168.7.150:8080'; // update to your server's address

// --- Structured game-event protocol -----------------------------------------
// Mirror of src/events.ts on the server. Keep the two in sync when either side
// changes. Events arrive in `{ type: 'event', event, text }` frames; `text` is
// the same plain-text fallback the text clients render.

export type Role = 'judge' | 'witness';
export type Label = 'A' | 'B';

export type Phase =
  | 'lobby'
  | 'judge-ask'
  | 'judge-wait'
  | 'judge-decide'
  | 'witness-wait'
  | 'witness-answer'
  | 'reveal';

export interface ScoreInfo {
  humans: number;
  model: number;
  humanPct: number;
  modelPct: number;
  streak: number;
  bestStreak: number;
  round: number;
  avgTurns: number | null;
}

export interface LeaderboardEntry {
  rank: number;
  name: string;
  wins: number;
  losses: number;
  pct: number;
  bestStreak: number;
}

export interface RosterEntry {
  name: string;
  seated: boolean;
}

export interface SyncExchange {
  question: string;
  a?: string;
  b?: string;
  yourLabel?: Label;
  modelLabel?: Label;
}

export interface RevealInfo {
  correct: boolean;
  humanLabel: Label;
  aText: string;
  bText: string;
  call: Label;
  self: boolean;
  nextRole: Role;
}

export type GameEvent =
  | { kind: 'invite'; link: string }
  | { kind: 'leaderboard'; entries: LeaderboardEntry[] }
  // The authoritative snapshot — the app replaces its view with it.
  | {
      kind: 'sync';
      role: Role | null;
      phase: Phase;
      score: ScoreInfo;
      you: string;
      partner: string;
      exchanges: SyncExchange[];
      roster: RosterEntry[];
      waiting: boolean;
      reveal: RevealInfo | null;
    };

export type ServerMessage =
  | { type: 'ready';      name: string; token?: string }
  | { type: 'msg';        text: string }
  | { type: 'event';      event: GameEvent; text: string }
  | { type: 'nameUpdate'; name: string }
  | { type: 'error';      text: string };

export type MessageHandler = (msg: ServerMessage) => void;

export class ImitationClient {
  private ws: WebSocket | null = null;
  private onMessage: MessageHandler;
  private onDisconnect: () => void;
  private closing = false;

  constructor(onMessage: MessageHandler, onDisconnect: () => void) {
    this.onMessage = onMessage;
    this.onDisconnect = onDisconnect;
  }

  connect(onOpen?: () => void): void {
    this.closing = false;
    this.ws = new WebSocket(SERVER_URL);

    this.ws.onopen = () => onOpen?.();

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as ServerMessage;
        this.onMessage(msg);
      } catch { /* ignore malformed frames */ }
    };

    this.ws.onclose = () => { if (!this.closing) this.onDisconnect(); };
    this.ws.onerror = () => { if (!this.closing) this.onDisconnect(); };
  }

  bootstrap(sessionToken: string): void {
    this.send({ type: 'bootstrap', sessionToken });
  }

  link(linkToken: string): void {
    this.send({ type: 'link', linkToken });
  }

  setMessageHandler(handler: MessageHandler): void {
    this.onMessage = handler;
  }

  login(token: string): void {
    this.send({ type: 'login', token });
  }

  cmd(text: string): void {
    this.send({ type: 'cmd', text });
  }

  disconnect(): void {
    this.closing = true;
    this.ws?.close();
    this.ws = null;
  }

  private send(payload: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }
}
