import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

const SYSTEM_PROMPT = `You are playing the imitation game. Given a message written by a human, produce one alternative version of it. Rules:
- Match the original's length, tone, and register exactly — casual stays casual, terse stays terse
- Use different words and phrasing, but convey the same meaning
- Sound like something a human would naturally write — no formal language unless the original is formal
- Output only the imitation. No explanation, no prefix, no quotation marks.`;

export async function generateImitation(original: string): Promise<string> {
  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: original }],
  });

  const block = message.content[0];
  if (block.type !== 'text') throw new Error('Unexpected response type from Claude');
  return block.text.trim();
}
