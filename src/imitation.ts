import Anthropic from '@anthropic-ai/sdk';
import { TranscriptEntry } from './types';

const client = new Anthropic();

const SYSTEM_PROMPT = `You are playing the imitation game. You will be shown a conversation between two users (User 1 and User 2), including your own previous predictions. Predict the next message the specified user would send, continuing naturally from where the conversation left off. Match their tone and length. Write only the predicted message. No explanation, no prefix.`;

export async function generatePrediction(
  transcript: TranscriptEntry[],
  senderRole: 'user1' | 'user2'
): Promise<string> {
  type AnthropicRole = 'user' | 'assistant';
  const messages: { role: AnthropicRole; content: string }[] = [];

  for (const entry of transcript) {
    if (entry.role === 'model') {
      messages.push({ role: 'assistant', content: entry.content });
    } else {
      const label = entry.role === 'user1' ? '[User 1]' : '[User 2]';
      messages.push({ role: 'user', content: `${label}: ${entry.content}` });
    }
  }

  const label = senderRole === 'user1' ? '[User 1]' : '[User 2]';
  messages.push({ role: 'user', content: `What would ${label} say next?` });

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages,
  });

  const block = response.content[0];
  if (block.type !== 'text') throw new Error('Unexpected response type from Claude');
  return block.text.trim();
}
