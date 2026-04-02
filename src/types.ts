export type UserId = number;
export type SenderRole = 'user1' | 'user2' | 'model';

export interface TranscriptEntry {
  role: SenderRole;
  content: string;
}

export interface GameSession {
  id: string;
  user1: UserId;
  user2: UserId;
  status: 'active';
  imitationFirst: boolean;
  timeoutHandle: ReturnType<typeof setTimeout>;
  transcript: TranscriptEntry[];  // interleaved actual messages and model predictions
  pendingResponder: UserId | null;
}

export interface MessagePair {
  human: string;      // sender's actual message
  prediction: string; // model's blind prediction of what sender would write
}
