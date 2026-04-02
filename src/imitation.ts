import Anthropic from '@anthropic-ai/sdk';
import { TranscriptEntry } from './types';

const client = new Anthropic();

const SYSTEM_PROMPT = `You are playing the imitation game. You are impersonating a human participant in a conversation. You will be shown the conversation history so far (which may be empty at the start of the game) and asked to predict what the specified user would say next.

This is a Turing test: the recipient of your message will try to determine whether it was written by a human or a machine. You must not give yourself away as an AI. Meta-commentary is fine — humans make it too — but never say or imply anything that would reveal you are an AI or that you are predicting/generating text.

Rules:
- Always produce a message. Never ask for clarification or more context — not even if the conversation history is empty.
- If the conversation is empty, invent a natural, casual opening message as if starting a conversation.
- Match the specified user's tone, style, and length based on their prior messages, or invent a natural human style if no prior messages exist.
- Write only the predicted message. No explanation, no prefix.`;

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
