import Anthropic from '@anthropic-ai/sdk';
import { TranscriptEntry } from './types';

const client = new Anthropic();

const BASE_PROMPT = `You are playing the imitation game. You are impersonating a human participant in a conversation. You will be shown the conversation history so far (which may be empty at the start of the game) and asked to predict what the specified user would say next.

This is a Turing test: the recipient of your message will try to determine whether it was written by a human or a machine. You must not give yourself away as an AI. Meta-commentary is fine — humans make it too — but never say or imply anything that would reveal you are an AI or that you are predicting/generating text.

Rules:
- Always produce a message. Never ask for clarification or more context, unless the human were predicted to do so.
- Match the specified user's tone, style, and length exactly.
- Do not use emojis under any circumstances.
- Write only the predicted message. No explanation, no prefix.`;

function buildSystemPrompt(priorMessages: string[], isOpener: boolean, selfFollow: boolean, assessments: string[]): string {
  const openerGuidance = isOpener
    ? '\nThe conversation has not started yet — you are generating an opening message. It must stand alone with no prior context. Default to a very short, casual opener. Do not ask a question or reference anything.'
    : selfFollow
    ? '\nThis user last spoke before an interruption (a scoring moment in the game). They are now sending their next message. The prior conversation is still context, but they are not replying to their own last message — predict something that moves the conversation forward naturally.'
    : '';

  if (priorMessages.length > 0) {
    const examples = priorMessages.map((m, i) => `  ${i + 1}. ${m}`).join('\n');
    let prompt = `${BASE_PROMPT}

The following are real messages this user has sent in previous sessions. Use them ONLY to calibrate style — pay close attention to their typical message length, vocabulary, punctuation habits, use of emoji or slang, sentence structure, and any spelling or grammatical errors they make.

If this user makes spelling or grammatical mistakes, reproduce errors at a similar rate and of a similar type in your prediction. Do not silently correct their writing.

Do NOT reproduce these messages verbatim, unless the message is a very short, context-free phrase (e.g. "hi", "yes", "ok") where repetition is natural. For anything longer or more specific, treat it as a writing sample only — never copy or closely paraphrase it, since each was written in response to a context you do not have.
${openerGuidance}
${examples}`;
    if (assessments.length > 0) {
      prompt += '\n\nLessons from previous imitation attempts:\n';
      prompt += assessments.map(a => `- ${a}`).join('\n');
    }
    return prompt;
  }

  let prompt = `${BASE_PROMPT}

You have no prior messages from this user. Default to a very short, casual opener — one to five words is normal. Do not compose a full paragraph.`;
  if (assessments.length > 0) {
    prompt += '\n\nLessons from previous imitation attempts:\n';
    prompt += assessments.map(a => `- ${a}`).join('\n');
  }
  return prompt;
}

export async function generatePrediction(
  transcript: TranscriptEntry[],
  senderRole: 'user1' | 'user2',
  priorMessages: string[],
  questionContext?: string,
  assessments: string[] = [],
): Promise<{ text: string; systemPrompt: string }> {
  let prompt = '';

  if (transcript.length > 0) {
    // Track the last human role so we can label model predictions correctly.
    let lastHumanRole: 'user1' | 'user2' | null = null;
    const lines: string[] = [];
    for (const entry of transcript) {
      if (entry.role === 'model') {
        const imitationOf = lastHumanRole === 'user1' ? '[User 1 imitation]' : '[User 2 imitation]';
        lines.push(`${imitationOf}: ${entry.content}`);
      } else if (entry.role === 'guess') {
        // skip guess entries — not part of the conversation context
      } else {
        lastHumanRole = entry.role;
        const label = entry.role === 'user1' ? '[User 1]' : '[User 2]';
        lines.push(`${label}: ${entry.content}`);
      }
    }
    prompt = `Conversation so far:\n${lines.join('\n')}\n\n`;
  }

  const label = senderRole === 'user1' ? '[User 1]' : '[User 2]';
  if (questionContext) {
    prompt += `The interrogator just asked: "${questionContext}"\n\nWhat would ${label} say in response?`;
  } else {
    prompt += `What would ${label} say next?`;
  }

  const realMessages = transcript.filter(e => e.role !== 'model');
  const isOpener = !questionContext && realMessages.length === 0;
  const lastRealRole = realMessages.at(-1)?.role ?? null;
  const selfFollow = !isOpener && !questionContext && lastRealRole === senderRole;

  const systemPrompt = buildSystemPrompt(priorMessages, isOpener, selfFollow, assessments);
  const model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';
  const response = await client.messages.create({
    model,
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: prompt }],
  });

  const block = response.content[0];
  if (block.type !== 'text') throw new Error('Unexpected response type from Claude');
  return { text: block.text.trim(), systemPrompt };
}

export async function generateAssessment(
  transcript: TranscriptEntry[],
  humanMessage: string,
  aiPrediction: string,
  correct: boolean,
): Promise<string> {
  const outcome = correct
    ? 'The human correctly identified the AI — the imitation did not fool them.'
    : 'The human was fooled — they thought the AI message was human.';

  let contextSection = '';
  // transcript here is everything before the human message and model prediction
  const priorEntries = transcript.filter(e => e.role !== 'guess');
  if (priorEntries.length > 0) {
    let lastHumanRole: 'user1' | 'user2' | null = null;
    const lines = priorEntries.map(e => {
      if (e.role === 'model') {
        return `[${lastHumanRole === 'user1' ? 'User 1' : 'User 2'} imitation]: ${e.content}`;
      }
      if (e.role !== 'guess') lastHumanRole = e.role;
      return `[${e.role === 'user1' ? 'User 1' : 'User 2'}]: ${e.content}`;
    });
    contextSection = `Conversation context available during prediction:\n${lines.join('\n')}\n\n`;
  }

  const prompt =
    `You just attempted to imitate a human in a Turing Test.\n\n` +
    `${contextSection}` +
    `The human actually wrote: "${humanMessage}"\n` +
    `Your imitation was: "${aiPrediction}"\n\n` +
    `${outcome}\n\n` +
    `In 2-3 sentences, assess what worked or didn't work in your imitation, and what you should do differently next time. ` +
    `Write the lesson in abstract terms (style, length, tone, vocabulary, punctuation) — do not reference the specific messages or conversation, since the assessment will be read later without that context.`;

  const model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';
  const response = await client.messages.create({
    model,
    max_tokens: 256,
    messages: [{ role: 'user', content: prompt }],
  });

  const block = response.content[0];
  if (block.type !== 'text') throw new Error('Unexpected response type from Claude');
  return block.text.trim();
}
