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
  firstSender: UserId;
  scores: { user1: number; user2: number };
  spectators: UserId[];
}

export interface MessagePair {
  human: string;      // sender's actual message
  prediction: string; // model's blind prediction of what sender would write
}

export interface UserProfile {
  messages: string[];
}

export interface UserProfileStore {
  [userId: string]: UserProfile;
}
