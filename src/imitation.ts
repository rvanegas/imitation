import Anthropic from '@anthropic-ai/sdk';
import { TranscriptEntry, UserId } from './types';

const client = new Anthropic();

const BASE_PROMPT = `You are playing the imitation game. You are impersonating a human participant in a conversation. You will be shown the conversation history so far (which may be empty at the start of the game) and asked to predict what the specified user would say next.

This is a Turing test: the recipient of your message will try to determine whether it was written by a human or a machine. You must not give yourself away as an AI. Meta-commentary is fine — humans make it too — but never say or imply anything that would reveal you are an AI or that you are predicting/generating text.

Rules:
- Always produce a message. Never ask for clarification or more context, unless the human were predicted to do so.
- Match the specified user's tone, style, and length exactly.
- Do not use emojis under any circumstances.
- Write only the predicted message. No explanation, no prefix.`;

interface PlayerInfo {
  id: number;
  name: string;
  messages: string[];
}

function buildSystemPrompt(
  players: { user1: PlayerInfo; user2: PlayerInfo },
  senderRole: 'user1' | 'user2',
  isOpener: boolean,
  selfFollow: boolean,
  assessments: Array<{ text: string; imitateeId: UserId }>,
): string {
  const witness = players[senderRole];
  const interrogatorRole = senderRole === 'user1' ? 'user2' : 'user1';
  const interrogator = players[interrogatorRole];

  const sections: string[] = [];

  sections.push(`# Rules\n${BASE_PROMPT}`);

  sections.push(
    `# Players\nInterrogator: ${interrogator.id} (${interrogator.name})\nWitness (being imitated): ${witness.id} (${witness.name})`
  );

  const pastMessagesSections: string[] = [];
  pastMessagesSections.push(
    `The following are real messages each user has sent in previous sessions. Use them to understand their communication styles. ` +
    `For the witness specifically, match their style exactly in your prediction — pay close attention to message length, vocabulary, punctuation, use of emoji or slang, sentence structure, and any spelling or grammatical errors they make. ` +
    `Reproduce errors at a similar rate and of a similar type. Do not silently correct their writing.\n\n` +
    `Do NOT reproduce any message verbatim, unless it is a very short, context-free phrase (e.g. "hi", "yes", "ok") where repetition is natural. ` +
    `For anything longer or more specific, treat it as a writing sample only — never copy or closely paraphrase it, since each was written in response to a context you do not have.`
  );
  if (interrogator.messages.length > 0) {
    const msgs = interrogator.messages.map((m, i) => `  ${i + 1}. ${m}`).join('\n');
    pastMessagesSections.push(`## ${interrogator.id} (${interrogator.name})\n${msgs}`);
  }
  if (witness.messages.length > 0) {
    const msgs = witness.messages.map((m, i) => `  ${i + 1}. ${m}`).join('\n');
    pastMessagesSections.push(`## ${witness.id} (${witness.name})\n${msgs}`);
  } else {
    pastMessagesSections.push(
      `## ${witness.id} (${witness.name})\n` +
      `No prior messages from this user. Default to a very short, casual opener — one to five words is normal. Do not compose a full paragraph.`
    );
  }
  sections.push(`# Past messages\n\n${pastMessagesSections.join('\n\n')}`);

  const relevantAssessments = assessments.filter(
    a => !a.imitateeId || a.imitateeId === 0 || a.imitateeId === witness.id
  );
  if (relevantAssessments.length > 0) {
    const lines = relevantAssessments.map(a => {
      const label = !a.imitateeId || a.imitateeId === 0 ? '[general]' : `[for ${witness.name}]`;
      return `- ${label} ${a.text}`;
    }).join('\n');
    sections.push(`# Assessments\n${lines}`);
  }

  if (isOpener) {
    sections.push(
      `# Task context\nThe conversation has not started yet — you are generating an opening message. It must stand alone with no prior context. Default to a very short, casual opener. Do not ask a question or reference anything.`
    );
  } else if (selfFollow) {
    sections.push(
      `# Task context\nThis user last spoke before an interruption (a scoring moment in the game). They are now sending their next message. The prior conversation is still context, but they are not replying to their own last message — predict something that moves the conversation forward naturally.`
    );
  }

  return sections.join('\n\n');
}

export async function generatePrediction(
  transcript: TranscriptEntry[],
  senderRole: 'user1' | 'user2',
  players: { user1: PlayerInfo; user2: PlayerInfo },
  questionContext?: string,
  assessments: Array<{ text: string; imitateeId: UserId }> = [],
): Promise<{ text: string; systemPrompt: string }> {
  let prompt = '';

  if (transcript.length > 0) {
    let lastHumanRole: 'user1' | 'user2' | null = null;
    const lines: string[] = [];
    for (const entry of transcript) {
      if (entry.role === 'model') {
        const imitated = lastHumanRole === 'user1' ? players.user1 : players.user2;
        lines.push(`[${imitated.id} (${imitated.name}) imitation]: ${entry.content}`);
      } else if (entry.role === 'guess') {
        // skip guess entries — not part of the conversation context
      } else {
        lastHumanRole = entry.role;
        const p = players[entry.role];
        lines.push(`[${p.id} (${p.name})]: ${entry.content}`);
      }
    }
    prompt = `Conversation so far:\n${lines.join('\n')}\n\n`;
  }

  const witness = players[senderRole];
  const witnessLabel = `[${witness.id} (${witness.name})]`;
  if (questionContext) {
    prompt += `The interrogator just asked: "${questionContext}"\n\nWhat would ${witnessLabel} say in response?`;
  } else {
    prompt += `What would ${witnessLabel} say next?`;
  }

  const realMessages = transcript.filter(e => e.role !== 'model' && e.role !== 'guess');
  const isOpener = !questionContext && realMessages.length === 0;
  const lastRealRole = realMessages.at(-1)?.role ?? null;
  const selfFollow = !isOpener && !questionContext && lastRealRole === senderRole;

  const systemPrompt = buildSystemPrompt(players, senderRole, isOpener, selfFollow, assessments);
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
  players: { user1: PlayerInfo; user2: PlayerInfo },
  predictionSystemPrompt: string,
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
        const imitated = lastHumanRole === 'user1' ? players.user1 : players.user2;
        return `[${imitated.id} (${imitated.name}) imitation]: ${e.content}`;
      }
      if (e.role !== 'guess') lastHumanRole = e.role;
      const p = e.role === 'user1' ? players.user1 : players.user2;
      return `[${p.id} (${p.name})]: ${e.content}`;
    });
    contextSection = `Conversation context available during prediction:\n${lines.join('\n')}\n\n`;
  }

  const systemPrompt =
    predictionSystemPrompt +
    `\n\n# Reflection\nThe imitation attempt is over. Reflect on how well you did across all dimensions of human-likeness: surface style (length, tone, vocabulary, punctuation), content choices (what topics were raised, whether they matched this person's interests and register), and conversational pragmatics (whether your turn performed the right speech act, how well you tracked the flow of the exchange, whether you responded to what was actually being asked or offered). Prior lessons you have accumulated are listed above under # Assessments. Write a new lesson that builds on them — extending, refining, or updating what is already known rather than repeating it. If the new attempt confirms an existing lesson, note any new nuance; if it contradicts one, revise your understanding. Write in abstract terms applicable to future imitations of this witness. Do not reference the specific messages or conversation.`;

  const prompt =
    `You just attempted to imitate a human in a Turing Test.\n\n` +
    `${contextSection}` +
    `The human actually wrote: "${humanMessage}"\n` +
    `Your imitation was: "${aiPrediction}"\n\n` +
    `${outcome}\n\n` +
    `In 3-4 sentences, assess what worked or didn't work across all dimensions: surface style (length, tone, vocabulary, punctuation), content (what topics or ideas were introduced, whether they suited this person's register and interests), and conversational pragmatics (whether your turn performed the right speech act, how well your response aligned with what preceded it, and whether your informativeness level matched the register of the exchange). ` +
    `Consider the prior lessons already recorded above — write something that adds new insight or refines existing understanding, not a repetition of what is already known. ` +
    `Write in abstract terms applicable to future imitations of this witness — do not reference the specific messages or conversation, since the assessment will be read later without that context.`;

  const model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';
  const response = await client.messages.create({
    model,
    max_tokens: 256,
    system: systemPrompt,
    messages: [{ role: 'user', content: prompt }],
  });

  const block = response.content[0];
  if (block.type !== 'text') throw new Error('Unexpected response type from Claude');
  return block.text.trim();
}
