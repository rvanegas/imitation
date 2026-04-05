export type UserId = number;
export type SenderRole = 'user1' | 'user2' | 'model' | 'guess';

export interface TranscriptEntry {
  role: SenderRole;
  content: string;
  // Only present when role === 'guess'
  correct?: boolean;
  guesser?: 'user1' | 'user2';
}

export interface GameSession {
  id: string;
  user1: UserId;
  user2: UserId;
  status: 'active';
  variation: 'symmetric' | 'original';
  imitationFirst: boolean;
  timeoutHandle: ReturnType<typeof setTimeout>;
  transcript: TranscriptEntry[];  // interleaved actual messages and model predictions
  // symmetric: pending sender/guesser; original: null=interrogator's turn, witnessId=answer phase
  pendingResponder: UserId | null;
  firstSender: UserId;            // symmetric only: who sends first in a round
  interrogator: UserId;           // original only: who is asking/guessing this round
  pendingPrediction: string | null; // original only: AI prediction stored between question and answer
  pendingSystemPrompt: string | null; // original only: system prompt paired with pendingPrediction
  scores: { user1: number; user2: number };
  teamScores: { humans: number; model: number };  // original variation only
  currentRoundTurns: number;          // original: Q&A exchanges in the current round
  totalTurns: number;                  // original: sum of turns across all rounds
  roundCount: number;                  // original: number of rounds completed
  spectators: UserId[];
  lastSystemPrompt?: string;
  lastActivity: number;
}

export interface MessagePair {
  human: string;      // sender's actual message
  prediction: string; // model's blind prediction of what sender would write
}

export interface UserProfile {
  messages: string[];
  name?: string;
}

export interface UserProfileStore {
  [userId: string]: UserProfile;
}
