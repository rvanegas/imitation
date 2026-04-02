export type UserId = number;

export interface GameSession {
  id: string;
  userA: UserId;
  userB: UserId;
  status: 'active';
  imitationFirst: boolean;
  timeoutHandle: ReturnType<typeof setTimeout>;
}

export interface PairedMessage {
  original: string;
  imitation: string;
}
