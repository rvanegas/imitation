import Anthropic from '@anthropic-ai/sdk';
import { ANTHROPIC_API_KEY, ANTHROPIC_MODEL } from './config';
import { getAllAssessments, setAssessments } from './userProfiles';

const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

async function main() {
  const assessments = getAllAssessments();
  if (assessments.length === 0) {
    console.log('No assessments to compact.');
    return;
  }
  console.log(`Compacting ${assessments.length} assessments...`);

  const prompt =
    `The following are self-assessments from a model that has been imitating humans in a Turing Test. ` +
    `Distill these into a compact list of the most important, actionable lessons — ` +
    `removing redundancy and keeping only what will most improve future imitations.\n\n` +
    assessments.map((a, i) => `${i + 1}. ${a}`).join('\n') +
    `\n\nReturn only a JSON array of strings, each a concise lesson.`;

  const response = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  const block = response.content[0];
  if (block.type !== 'text') throw new Error('Unexpected response type');
  const compacted: string[] = JSON.parse(block.text.trim());
  setAssessments(compacted);
  console.log(`Compacted to ${compacted.length} lessons.`);
}

main().catch(console.error);
