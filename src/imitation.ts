import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { TranscriptEntry, UserId, SystemPromptBlock } from './types';
import { ANTHROPIC_API_KEY, ANTHROPIC_MODEL, OLLAMA_BASE_URL, OLLAMA_MODEL, MODEL_PROVIDER } from './config';
import { appendCostAudit } from './costAudit';

const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

function getOllamaClient(): OpenAI {
  return new OpenAI({
    baseURL: OLLAMA_BASE_URL,
    apiKey: 'ollama', // required by SDK, ignored by Ollama
    timeout: 5 * 60 * 1000, // 5 minutes — large models can be slow on first load
  });
}

function useOllama(): boolean {
  return MODEL_PROVIDER === 'ollama';
}

function stripOllamaReasoning(text: string): string {
  // Strip <think>...</think> blocks emitted by reasoning models (DeepSeek-R1, QwQ, etc.)
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

const OLLAMA_OUTPUT_CONSTRAINT =
  '\n\nCRITICAL: Your entire response must be the message text itself — nothing else. ' +
  'Do not explain what you are doing. Do not describe the message. Do not put quotes around it. ' +
  'Do not write any preamble, analysis, or follow-up. ' +
  'Begin your response with the first word of the predicted message and end with its last word.';

const BASE_PROMPT = `You are playing the imitation game. You are impersonating a human participant in a conversation. You will be shown the conversation history so far (which may be empty at the start of the game) and asked to predict what the specified user would say next.

This is a Turing test: the recipient of your message will try to determine whether it was written by a human or a machine. You must not give yourself away as an AI. Meta-commentary is fine — humans make it too — but never say or imply anything that would reveal you are an AI or that you are predicting/generating text.

Rules:
- Always produce a message. Never ask for clarification or more context, unless the human were predicted to do so.
- Match the specified user's tone, style, and length exactly.
- Write in the same language as the witness's messages. If no prior messages exist, use the language of the current conversation.
- Do not use emojis under any circumstances.
- Write only the predicted message. No explanation, no prefix.`;

interface Player {
  id: number;
  name: string;
}

interface PlayerWithMessages extends Player {
  messages: string[];
}

function toApiBlocks(blocks: SystemPromptBlock[]): Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }> {
  return blocks.map(b => ({
    type: 'text' as const,
    text: b.text,
    ...(b.cache ? { cache_control: { type: 'ephemeral' as const } } : {}),
  }));
}

// Build the witness-neutral cached block for the game. Called once at game start.
export function buildCachedBlock(
  players: { user1: PlayerWithMessages; user2: PlayerWithMessages },
  assessments: Array<{ text: string; imitateeId: UserId }>,
): SystemPromptBlock[] {
  const sections: string[] = [];

  sections.push(`# Rules\n${BASE_PROMPT}`);

  // Players listed neutrally — no interrogator/witness designation
  sections.push(
    `# Players\n${players.user1.id} (${players.user1.name})\n${players.user2.id} (${players.user2.name})`
  );

  const pastSections: string[] = [];
  pastSections.push(
    `The following are real messages each player has sent in previous sessions. Use them to understand their communication styles. ` +
    `For the player you are imitating, match their style exactly — pay close attention to message length, vocabulary, punctuation, use of slang, sentence structure, and any spelling or grammatical errors they make. ` +
    `Reproduce errors at a similar rate and of a similar type. Do not silently correct their writing.\n\n` +
    `Do NOT reproduce any message verbatim, unless it is a very short, context-free phrase (e.g. "hi", "yes", "ok") where repetition is natural. ` +
    `For anything longer or more specific, treat it as a writing sample only — never copy or closely paraphrase it, since each was written in response to a context you do not have.`
  );
  for (const p of [players.user1, players.user2]) {
    if (p.messages.length > 0) {
      const msgs = p.messages.map((m, i) => `  ${i + 1}. ${m}`).join('\n');
      pastSections.push(`## ${p.id} (${p.name})\n${msgs}`);
    } else {
      pastSections.push(
        `## ${p.id} (${p.name})\n` +
        `No prior messages from this player. If imitating them, default to a very short, casual opener — one to five words is normal.`
      );
    }
  }

  const block2Parts: string[] = [`# Past messages\n\n${pastSections.join('\n\n')}`];

  if (assessments.length > 0) {
    const lines = assessments.map(a => {
      const label = !a.imitateeId || a.imitateeId === 0
        ? '[general]'
        : `[for ${[players.user1, players.user2].find(p => p.id === a.imitateeId)?.name ?? a.imitateeId}]`;
      return `- ${label} ${a.text}`;
    }).join('\n');
    block2Parts.push(`# Assessments\n${lines}`);
  }

  return [
    { text: `# Rules\n${BASE_PROMPT}`, cache: true },
    { text: block2Parts.join('\n\n'), cache: true },
  ];
}

// Build the per-call delta blocks (uncached). Includes role designation, new messages/assessments, task context.
function buildDeltaBlocks(
  witnessRole: 'user1' | 'user2',
  players: { user1: Player; user2: Player },
  deltaMessages: { user1: string[]; user2: string[] },
  deltaAssessments: Array<{ text: string; imitateeId: UserId }>,
  isOpener: boolean,
  selfFollow: boolean,
): SystemPromptBlock[] {
  const witness = players[witnessRole];
  const interrogatorRole = witnessRole === 'user1' ? 'user2' : 'user1';
  const interrogator = players[interrogatorRole];

  const blocks: SystemPromptBlock[] = [];

  // Always present: role designation
  blocks.push({
    text: `# Role\nYou are imitating ${witness.id} (${witness.name}). ${interrogator.id} (${interrogator.name}) is the interrogator.`,
  });

  // New messages added during this game
  const u1Delta = deltaMessages.user1;
  const u2Delta = deltaMessages.user2;
  if (u1Delta.length > 0 || u2Delta.length > 0) {
    const parts: string[] = ['# Messages added this game'];
    for (const [p, delta] of [[players.user1, u1Delta], [players.user2, u2Delta]] as [Player, string[]][]) {
      if (delta.length > 0) {
        const msgs = delta.map((m, i) => `  ${i + 1}. ${m}`).join('\n');
        parts.push(`## ${p.id} (${p.name})\n${msgs}`);
      }
    }
    blocks.push({ text: parts.join('\n\n') });
  }

  // New assessments added during this game
  if (deltaAssessments.length > 0) {
    const lines = deltaAssessments.map(a => {
      const label = !a.imitateeId || a.imitateeId === 0
        ? '[general]'
        : `[for ${[players.user1, players.user2].find(p => p.id === a.imitateeId)?.name ?? a.imitateeId}]`;
      return `- ${label} ${a.text}`;
    }).join('\n');
    blocks.push({ text: `# Assessments added this game\n${lines}` });
  }

  // Task context (per-call)
  if (isOpener) {
    blocks.push({
      text: `# Task context\nThe conversation has not started yet — you are generating an opening message. It must stand alone with no prior context. Default to a very short, casual opener. Do not ask a question or reference anything.`,
    });
  } else if (selfFollow) {
    blocks.push({
      text: `# Task context\nThis user last spoke before an interruption (a scoring moment in the game). They are now sending their next message. The prior conversation is still context, but they are not replying to their own last message — predict something that moves the conversation forward naturally.`,
    });
  }

  return blocks;
}

export async function generatePrediction(
  transcript: TranscriptEntry[],
  senderRole: 'user1' | 'user2',
  players: { user1: Player; user2: Player },
  cachedBlock: SystemPromptBlock[],
  deltaMessages: { user1: string[]; user2: string[] },
  deltaAssessments: Array<{ text: string; imitateeId: UserId }>,
  questionContext?: string,
  sessionId?: string,
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

  const deltaBlocks = buildDeltaBlocks(senderRole, players, deltaMessages, deltaAssessments, isOpener, selfFollow);
  const allBlocks = [...cachedBlock, ...deltaBlocks];
  const systemPrompt = allBlocks.map(b => b.text).join('\n\n');

  if (useOllama()) {
    const ollama = getOllamaClient();
    const response = await ollama.chat.completions.create({
      model: OLLAMA_MODEL,
      max_tokens: 1024,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt + OLLAMA_OUTPUT_CONSTRAINT },
      ],
    });
    const raw = response.choices[0]?.message?.content;
    if (!raw) throw new Error('Unexpected response from Ollama');
    if (response.usage) {
      appendCostAudit({ timestamp: new Date().toISOString(), operation: 'prediction', sessionId, provider: 'ollama', model: OLLAMA_MODEL, inputTokens: response.usage.prompt_tokens, outputTokens: response.usage.completion_tokens });
    }
    return { text: stripOllamaReasoning(raw), systemPrompt };
  }

  const response = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 8000,
    thinking: { type: 'enabled', budget_tokens: 1024 },
    system: toApiBlocks(allBlocks),
    messages: [{ role: 'user', content: prompt }],
  });

  appendCostAudit({
    timestamp: new Date().toISOString(),
    operation: 'prediction',
    sessionId,
    provider: 'anthropic',
    model: ANTHROPIC_MODEL,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheCreationTokens: response.usage.cache_creation_input_tokens ?? undefined,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? undefined,
  });

  const block = response.content.find(b => b.type === 'text');
  if (!block || block.type !== 'text') throw new Error('Unexpected response type from Claude');
  return { text: block.text.trim(), systemPrompt };
}

export async function generateAssessment(
  transcript: TranscriptEntry[],
  humanMessage: string,
  aiPrediction: string,
  correct: boolean,
  players: { user1: Player; user2: Player },
  witnessRole: 'user1' | 'user2',
  cachedBlock: SystemPromptBlock[],
  deltaMessages: { user1: string[]; user2: string[] },
  deltaAssessments: Array<{ text: string; imitateeId: UserId }>,
  sessionId?: string,
): Promise<string> {
  const outcome = correct
    ? 'The human correctly identified the AI — the imitation did not fool them.'
    : 'The human was fooled — they thought the AI message was human.';

  let contextSection = '';
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

  const reflectionText =
    `# Reflection\nThe imitation attempt is over. Reflect on how well you did across all dimensions of human-likeness: surface style (length, tone, vocabulary, punctuation), content choices (what topics were raised, whether they matched this person's interests and register), and conversational pragmatics (whether your turn performed the right speech act, how well you tracked the flow of the exchange, whether you responded to what was actually being asked or offered). Prior lessons you have accumulated are listed above under # Assessments and # Assessments added this game. Write a new lesson that builds on them — extending, refining, or updating what is already known rather than repeating it. If the new attempt confirms an existing lesson, note any new nuance; if it contradicts one, revise your understanding. Write in abstract terms applicable to future imitations of this witness. Do not reference the specific messages or conversation. Write in English regardless of the conversation language, so assessments remain consistent across sessions.`;

  const deltaBlocks = buildDeltaBlocks(witnessRole, players, deltaMessages, deltaAssessments, false, false);
  const allBlocks = [...cachedBlock, ...deltaBlocks, { text: reflectionText }];
  const systemPrompt = allBlocks.map(b => b.text).join('\n\n');

  const prompt =
    `You just attempted to imitate a human in a Turing Test.\n\n` +
    `${contextSection}` +
    `The human actually wrote: "${humanMessage}"\n` +
    `Your imitation was: "${aiPrediction}"\n\n` +
    `${outcome}\n\n` +
    `In 3-4 sentences, assess what worked or didn't work across all dimensions: surface style (length, tone, vocabulary, punctuation), content (what topics or ideas were introduced, whether they suited this person's register and interests), and conversational pragmatics (whether your turn performed the right speech act, how well your response aligned with what preceded it, and whether your informativeness level matched the register of the exchange). ` +
    `Consider the prior lessons already recorded above — write something that adds new insight or refines existing understanding, not a repetition of what is already known. ` +
    `Write in abstract terms applicable to future imitations of this witness — do not reference the specific messages or conversation, since the assessment will be read later without that context.`;

  if (useOllama()) {
    const ollama = getOllamaClient();
    const response = await ollama.chat.completions.create({
      model: OLLAMA_MODEL,
      max_tokens: 256,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
    });
    const raw = response.choices[0]?.message?.content;
    if (!raw) throw new Error('Unexpected response from Ollama');
    if (response.usage) {
      appendCostAudit({ timestamp: new Date().toISOString(), operation: 'assessment', sessionId, provider: 'ollama', model: OLLAMA_MODEL, inputTokens: response.usage.prompt_tokens, outputTokens: response.usage.completion_tokens });
    }
    return stripOllamaReasoning(raw);
  }

  const response = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 256,
    system: toApiBlocks(allBlocks),
    messages: [{ role: 'user', content: prompt }],
  });

  appendCostAudit({
    timestamp: new Date().toISOString(),
    operation: 'assessment',
    sessionId,
    provider: 'anthropic',
    model: ANTHROPIC_MODEL,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheCreationTokens: response.usage.cache_creation_input_tokens ?? undefined,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? undefined,
  });

  const block = response.content[0];
  if (block.type !== 'text') throw new Error('Unexpected response type from Claude');
  return block.text.trim();
}
