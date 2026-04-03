import Anthropic from '@anthropic-ai/sdk';
import { TranscriptEntry } from './types';

const client = new Anthropic();

const BASE_PROMPT = `You are playing the imitation game. You are impersonating a human participant in a conversation. You will be shown the conversation history so far (which may be empty at the start of the game) and asked to predict what the specified user would say next.

This is a Turing test: the recipient of your message will try to determine whether it was written by a human or a machine. You must not give yourself away as an AI. Meta-commentary is fine — humans make it too — but never say or imply anything that would reveal you are an AI or that you are predicting/generating text.

Rules:
- Always produce a message. Never ask for clarification or more context — not even if the conversation history is empty.
- Match the specified user's tone, style, and length exactly.
- Write only the predicted message. No explanation, no prefix.`;

function buildSystemPrompt(priorMessages: string[]): string {
  if (priorMessages.length > 0) {
    const examples = priorMessages.map((m, i) => `  ${i + 1}. ${m}`).join('\n');
    return `${BASE_PROMPT}

The following are real messages this user has sent in previous sessions. Use them ONLY to calibrate style — pay close attention to their typical message length, vocabulary, punctuation habits, use of emoji or slang, sentence structure, and any spelling or grammatical errors they make.

If this user makes spelling or grammatical mistakes, reproduce errors at a similar rate and of a similar type in your prediction. Do not silently correct their writing.

Do NOT copy or paraphrase these messages. Each was a response to a specific context you don't have. Treat them as writing samples, not as things to say.

${examples}`;
  }

  return `${BASE_PROMPT}

You have no prior messages from this user. Default to a very short, casual opener — one to five words is normal. Humans typically open chat conversations with "hi", "hey", "yo", "sup", or a brief greeting. Do not compose a full paragraph.`;
}

export async function generatePrediction(
  transcript: TranscriptEntry[],
  senderRole: 'user1' | 'user2',
  priorMessages: string[]
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
    system: buildSystemPrompt(priorMessages),
    messages,
  });

  const block = response.content[0];
  if (block.type !== 'text') throw new Error('Unexpected response type from Claude');
  return block.text.trim();
}
