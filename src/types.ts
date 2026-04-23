export type UserId = number;
export type SenderRole = 'user1' | 'user2' | 'model' | 'guess';

export interface SystemPromptBlock {
  text: string;
  cache?: true;  // → cache_control: { type: 'ephemeral' } in Anthropic API call
}

export interface TranscriptEntry {
  role: SenderRole;
  content: string;
  // Only present when role === 'guess'
  correct?: boolean;
  guesser?: 'user1' | 'user2';
}

export interface GameSession {
  id: string;
  user1: UserId | null;
  user2: UserId | null;
  status: 'active';
  imitationFirst: boolean;
  timeoutHandle: ReturnType<typeof setTimeout>;
  transcript: TranscriptEntry[];  // interleaved actual messages and model predictions
  // null=judge's turn, witnessId=answer phase
  pendingResponder: UserId | null;
  interrogator: UserId;           // who is the judge this round
  pendingPrediction: string | null; // AI prediction stored between question and answer
  pendingSystemPrompt: string | null; // system prompt paired with pendingPrediction
  teamScores: { humans: number; model: number };  // raw point counts
  winStreak: number;                    // original: consecutive rounds won by humans
  longestWinStreak: number;             // original: longest such streak in this session
  currentRoundTurns: number;          // original: Q&A exchanges in the current round
  totalTurns: number;                  // original: sum of turns across all rounds
  roundCount: number;                  // original: number of rounds completed
  spectators: UserId[];
  lastSystemPrompt?: string;
  // Persisted — baseline snapshot counts captured at game start; used to reconstruct cachedSystemPromptBlock after restart
  baseUser1MsgCount?: number;
  baseUser2MsgCount?: number;
  baseAssessmentCount?: number;
  // Transient — not persisted; rebuilt lazily after restart using base counts above
  cachedSystemPromptBlock?: SystemPromptBlock[];
  createdAt: number;
  lastActivity: number;
}

export interface MessagePair {
  human: string;      // sender's actual message
  prediction: string; // model's blind prediction of what sender would write
}

export interface UserProfile {
  messages: string[];
  name?: string;
  telegramId?: number;
  wsToken?: string;      // persistent auth token for WebSocket clients
  lastSession?: string;  // ISO timestamp of most recent presence in a game session
}
