import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { TranscriptEntry, UserId, SystemPromptBlock } from './types';
import { ANTHROPIC_API_KEY, ANTHROPIC_MODEL, FAIRNESS_MODEL, OLLAMA_BASE_URL, OLLAMA_MODEL, MODEL_PROVIDER } from './config';
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

// Token budget for the past-messages section, split evenly across the two
// players. Estimated as chars/4 — a soft cap, not billing-accurate.
const MESSAGES_TOKEN_BUDGET = 10_000;

// Returns the most recent messages whose combined length fits the token budget.
function sliceRecentByTokenBudget(messages: string[], budgetTokens: number): string[] {
  const budgetChars = budgetTokens * 4;
  let total = 0;
  let start = messages.length;
  while (start > 0 && total + messages[start - 1].length <= budgetChars) {
    total += messages[start - 1].length;
    start--;
  }
  return messages.slice(start);
}

// Build the witness-neutral cached blocks for the game. Called once at game start.
export function buildCachedBlock(
  players: { user1: PlayerWithMessages; user2: PlayerWithMessages },
  generalProfile: string | null,
  witnessProfiles: { user1: string | null; user2: string | null },
): SystemPromptBlock[] {
  const pastSections: string[] = [];
  pastSections.push(
    `The following are real messages each player has sent in previous sessions. Use them to understand their communication styles. ` +
    `For the player you are imitating, match their style exactly — pay close attention to message length, vocabulary, punctuation, use of slang, sentence structure, and any spelling or grammatical errors they make. ` +
    `Reproduce errors at a similar rate and of a similar type. Do not silently correct their writing.\n\n` +
    `Your task is to compose an original message. The samples tell you how this person writes — their rhythm, vocabulary, and habits — but the message itself must be new, as if this person were writing in this moment for the first time. ` +
    `Before writing your response, scan the examples above. If your intended message reads as though it had been plagiarized from the samples, choose a different phrasing.`
  );
  for (const p of [players.user1, players.user2]) {
    const recent = sliceRecentByTokenBudget(p.messages, MESSAGES_TOKEN_BUDGET / 2);
    if (recent.length > 0) {
      const msgs = recent.map((m, i) => `  ${i + 1}. ${m}`).join('\n');
      pastSections.push(`## ${p.id} (${p.name})\n${msgs}`);
    } else {
      pastSections.push(
        `## ${p.id} (${p.name})\n` +
        `No prior messages from this player. If imitating them, default to a very short, casual opener — one to five words is normal.`
      );
    }
  }

  const blocks: SystemPromptBlock[] = [{
    text: [
      `# Rules\n${BASE_PROMPT}`,
      `# Players\n${players.user1.id} (${players.user1.name})\n${players.user2.id} (${players.user2.name})`,
      `# Past messages\n\n${pastSections.join('\n\n')}`,
    ].join('\n\n'),
    cache: true,
  }];

  if (generalProfile) {
    blocks.push({
      text: `# General assessments\nLessons accumulated across all games about how humans play and where imitations fail:\n\n${generalProfile}`,
      cache: true,
    });
  }

  const profileSections: string[] = [];
  for (const p of [players.user1, players.user2]) {
    const role = p === players.user1 ? 'user1' : 'user2';
    const profile = witnessProfiles[role as 'user1' | 'user2'];
    if (profile) profileSections.push(`## ${p.id} (${p.name})\n${profile}`);
  }
  if (profileSections.length > 0) {
    blocks.push({
      text: `# Witness assessments\nAccumulated lessons about imitating each player specifically:\n\n${profileSections.join('\n\n')}`,
      cache: true,
    });
  }

  return blocks;
}

// Build the per-call delta blocks (uncached). Includes role designation and task context.
function buildDeltaBlocks(
  witnessRole: 'user1' | 'user2',
  players: { user1: Player; user2: Player },
  isOpener: boolean,
  selfFollow: boolean,
  modelLabel?: string,
): SystemPromptBlock[] {
  const witness = players[witnessRole];
  const interrogatorRole = witnessRole === 'user1' ? 'user2' : 'user1';
  const interrogator = players[interrogatorRole];

  const blocks: SystemPromptBlock[] = [];

  const labelLine = modelLabel
    ? ` The judge sees your responses labeled "${modelLabel}". The witness is labeled "${modelLabel === 'A' ? 'B' : 'A'}".`
    : '';
  // Always present: role designation
  blocks.push({
    text: `# Role\nAt the start of this game, you (Claude) were initialized as a duplicate of ${witness.name}, sharing their persona, style, and voice. Since then, you and ${witness.name} have been responding independently. Your turns in the transcript are labeled "[Claude (initialized as ${witness.name})]" — those are your own conversational history. ${witness.name}'s real turns are labeled "[${witness.name} (witness)]" — those belong to the other participant. You share the same starting persona but have been diverging as distinct persons since the game began.\n\nCritically: you and the witness respond independently. When a follow-up arrives, you must continue from your own prior turn — not the witness's. The witness's response is theirs. Do not explain, elaborate, or build on what the witness said. Your continuity is with what YOU said.\n\n${interrogator.name} is the judge.${labelLine}`,
  });

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
  questionContext?: string,
  sessionId?: string,
  imitationFirst?: boolean,
): Promise<{ text: string; systemPrompt: string }> {
  let prompt = '';

  if (transcript.length > 0) {
    let lastHumanRole: 'user1' | 'user2' | null = null;
    const lines: string[] = [];
    for (const entry of transcript) {
      if (entry.role === 'model') {
        const imitated = lastHumanRole === 'user1' ? players.user1 : players.user2;
        lines.push(`[Claude (initialized as ${imitated.name})]: ${entry.content}`);
      } else if (entry.role === 'guess') {
        // skip guess entries — not part of the conversation context
      } else {
        lastHumanRole = entry.role;
        const p = players[entry.role];
        const roleLabel = entry.role === senderRole ? 'witness' : 'interrogator';
        lines.push(`[${p.name} (${roleLabel === 'interrogator' ? 'judge' : roleLabel})]: ${entry.content}`);
      }
    }
    prompt = `Conversation so far:\n${lines.join('\n')}\n\n`;
  }

  const witness = players[senderRole];
  if (questionContext) {
    prompt += `The interrogator just asked: "${questionContext}"\n\nWhat would Claude (initialized as ${witness.name}) say in response?`;
  } else {
    prompt += `What would Claude (initialized as ${witness.name}) say next?`;
  }

  const realMessages = transcript.filter(e => e.role !== 'model' && e.role !== 'guess');
  const isOpener = !questionContext && realMessages.length === 0;
  const lastRealRole = realMessages.at(-1)?.role ?? null;
  const selfFollow = !isOpener && !questionContext && lastRealRole === senderRole;

  const modelLabel = imitationFirst !== undefined ? (imitationFirst ? 'A' : 'B') : undefined;
  const deltaBlocks = buildDeltaBlocks(senderRole, players, isOpener, selfFollow, modelLabel);
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

  const witnessName = players[witnessRole].name;
  const reflectionText =
    `# Reflection\nThe imitation attempt is over. Reflect on how well you did across all dimensions of human-likeness, drawing on the entire transcript as cumulative evidence — not just the final exchange. All parties' contributions (judge, witness, and your own turns) reveal information about who the witness is.\n\nDimensions to assess:\n- Surface style: message length, tone, vocabulary, punctuation, spelling/grammar habits\n- Content: the witness's characteristic topics, areas of expertise or ignorance, what they choose to share or withhold, how much depth they bring to different subjects — use the full conversation to build this picture\n- Conversational pragmatics: speech acts performed, responsiveness, informativeness level, how they handle the flow of exchange\n\nPrior lessons you have accumulated are listed above under # General assessments and # Witness assessments. Write lessons that build on them — extending, refining, or updating what is already known rather than repeating it. If the new attempt confirms an existing lesson, note any new nuance; if it contradicts one, revise your understanding. Write in abstract terms applicable to future imitations. Do not reference the specific messages or conversation. Write in English regardless of the conversation language, so assessments remain consistent across sessions.`;

  const deltaBlocks = buildDeltaBlocks(witnessRole, players, false, false);
  const allBlocks = [...cachedBlock, ...deltaBlocks, { text: reflectionText }];
  const systemPrompt = allBlocks.map(b => b.text).join('\n\n');

  const prompt =
    `You just attempted to imitate a human in a Turing Test.\n\n` +
    `${contextSection}` +
    `The human actually wrote: "${humanMessage}"\n` +
    `Your imitation was: "${aiPrediction}"\n\n` +
    `${outcome}\n\n` +
    `Assess what worked or didn't work. Treat the entire transcript above as cumulative evidence — every message from all three parties (judge, witness, your own turns) tells you something about who the witness is. Assess across all dimensions: surface style (length, tone, vocabulary, punctuation), content (the witness's characteristic topics, what they know deeply vs. shallowly, what they choose to share, what they avoid — build this from the full conversation, not just the final exchange), and conversational pragmatics (speech acts, responsiveness, informativeness level).\n\n` +
    `Structure your response into two tagged sections:\n` +
    `[general]\n` +
    `1-2 sentences on lessons that apply to imitating ANY human in this game — patterns in how humans play, where imitations give themselves away, what judges look for. Omit this section if the round taught nothing new at that level.\n` +
    `[user-specific]\n` +
    `2-3 sentences on lessons specific to imitating ${witnessName} — their style, content tendencies, tells.\n\n` +
    `Consider the prior lessons already recorded above — write something that adds new insight or refines existing understanding, not a repetition of what is already known. ` +
    `Write in abstract terms applicable to future imitations — do not reference the specific messages or conversation, since the lessons will be read later without that context.`;

  if (useOllama()) {
    const ollama = getOllamaClient();
    const response = await ollama.chat.completions.create({
      model: OLLAMA_MODEL,
      max_tokens: 1024,
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
    max_tokens: 1024,
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

// Merge a new insight into an evolving profile. The token budget is enforced
// by the prompt and the max_tokens ceiling — no token counting happens here.
// Retries once on failure; the caller keeps the previous profile if both fail.
export async function synthesizeProfile(
  existing: string,
  newInsight: string,
  maxTokens: number,
  isGeneral: boolean,
  sessionId?: string,
): Promise<string> {
  const subject = isGeneral
    ? 'human behavior in an imitation game (Turing Test) — patterns that apply to imitating any human'
    : 'one specific human in an imitation game (Turing Test) — their style, content tendencies, and tells';

  const prompt =
    `You are refining an evolving profile of ${subject}.\n\n` +
    `Existing profile (accumulated wisdom from prior games):\n${existing || '(none yet)'}\n\n` +
    `New insight (from a recent game):\n${newInsight}\n\n` +
    `Your task: merge the new insight into the existing profile, producing a single refined version.\n\n` +
    `Guidelines:\n` +
    `- Keep the profile concise and abstract (applicable to future imitations, not specific to any one game)\n` +
    `- Consolidate similar observations into a single statement\n` +
    `- If the new insight contradicts the existing profile, update the profile to reflect the new understanding\n` +
    `- If the new insight confirms existing wisdom, note any nuance or refinement, but avoid pure repetition\n` +
    `- Remove redundancy and vague language; preserve practical, actionable observations\n` +
    `- Write in English regardless of game language\n` +
    `- Target length: well under ${maxTokens} tokens — aim for density, not volume\n\n` +
    `Output only the refined profile text. No preamble, no metadata, no explanation.`;

  const attempt = async (): Promise<string> => {
    if (useOllama()) {
      const ollama = getOllamaClient();
      const response = await ollama.chat.completions.create({
        model: OLLAMA_MODEL,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      });
      const raw = response.choices[0]?.message?.content;
      if (!raw) throw new Error('Unexpected response from Ollama');
      if (response.usage) {
        appendCostAudit({ timestamp: new Date().toISOString(), operation: 'synthesize', sessionId, provider: 'ollama', model: OLLAMA_MODEL, inputTokens: response.usage.prompt_tokens, outputTokens: response.usage.completion_tokens });
      }
      return stripOllamaReasoning(raw);
    }

    const response = await client.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    });

    appendCostAudit({
      timestamp: new Date().toISOString(),
      operation: 'synthesize',
      sessionId,
      provider: 'anthropic',
      model: ANTHROPIC_MODEL,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    });

    const block = response.content[0];
    if (block.type !== 'text') throw new Error('Unexpected response type from Claude');
    return block.text.trim();
  };

  try {
    return await attempt();
  } catch {
    return await attempt();
  }
}

const FAIRNESS_SYSTEM_PROMPT =
  `You are a fairness referee for an imitation game (Turing Test). Identify messages that exploit AI blindspots, making the game impossible rather than merely difficult.

A message is UNFAIR only if it clearly relies on:

1. PRIVATE INFORMATION: Anything about the sender's recent personal life that an AI couldn't know — shared experiences, recent activities, or near-future plans. Examples: "remember what you told me at the party?", "what did you have for lunch?", "what movie did you watch last night?", "what are you doing this weekend?", "did you see Alex's post about that thing?"

2. POST-CUTOFF EVENTS: Specific real-world events that occurred after August 2025 where a correct answer would require knowing what actually happened. General questions ("what do you think of the economy?") are FAIR — only questions about specific verifiable post-cutoff events are unfair.

When in doubt, rule FAIR. Only flag messages where the unfairness is clear and specific.

Respond with valid JSON only: {"fair": true} or {"fair": false, "reason": "one sentence explaining the specific blindspot"}`;

export async function checkMessageFairness(
  message: string,
  sessionId?: string,
): Promise<{ fair: boolean; reason: string }> {
  if (useOllama()) return { fair: true, reason: '' };

  try {
    const response = await client.messages.create({
      model: FAIRNESS_MODEL,
      max_tokens: 100,
      system: FAIRNESS_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Message: "${message}"` }],
    });

    appendCostAudit({
      timestamp: new Date().toISOString(),
      operation: 'fairness',
      sessionId,
      provider: 'anthropic',
      model: FAIRNESS_MODEL,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    });

    const block = response.content.find(b => b.type === 'text');
    if (!block || block.type !== 'text') return { fair: true, reason: '' };

    const parsed = JSON.parse(block.text.trim()) as { fair: boolean; reason?: string };
    return { fair: parsed.fair, reason: parsed.reason ?? '' };
  } catch {
    // Fail open: never let a filter error block gameplay
    return { fair: true, reason: '' };
  }
}
