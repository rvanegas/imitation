import { UserId } from './types';
import { GameEvent } from './events';

export interface Transport {
  // `text` is the always-present plain-text fallback (Telegram, terminal, raw
  // socket). `event` is an optional structured payload for rich clients (the
  // app); text-only transports ignore it. A send with empty `text` and an event
  // is "event-only" — text transports should skip it.
  send(userId: UserId, text: string, event?: GameEvent): Promise<void>;
  makeInviteLink(token: string, userId?: UserId): string;
}
