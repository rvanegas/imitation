import { describe, it, expect } from 'vitest';
import { buildCachedBlock } from '../src/imitation';

const alice = { id: 1, name: 'alice', messages: ['hey', 'what up'] };
const bob = { id: 2, name: 'bob', messages: ['yo'] };

function fullText(blocks: Array<{ text: string }>): string {
  return blocks.map(b => b.text).join('\n\n');
}

describe('buildCachedBlock', () => {
  it('always contains rules, players, and past messages', () => {
    const blocks = buildCachedBlock({ user1: alice, user2: bob }, null, { user1: null, user2: null });
    const text = fullText(blocks);
    expect(text).toContain('# Rules');
    expect(text).toContain('# Players');
    expect(text).toContain('# Past messages');
    expect(text).toContain('1 (alice)');
    expect(text).toContain('what up');
  });

  it('marks every block cacheable', () => {
    const blocks = buildCachedBlock(
      { user1: alice, user2: bob },
      'general wisdom',
      { user1: 'alice profile', user2: 'bob profile' },
    );
    expect(blocks.length).toBe(3);
    for (const b of blocks) expect(b.cache).toBe(true);
  });

  it('omits profile sections when absent', () => {
    const blocks = buildCachedBlock({ user1: alice, user2: bob }, null, { user1: null, user2: null });
    const text = fullText(blocks);
    expect(blocks.length).toBe(1);
    expect(text).not.toContain('# General assessments');
    expect(text).not.toContain('# Witness assessments');
  });

  it('includes only the provided witness profiles', () => {
    const blocks = buildCachedBlock(
      { user1: alice, user2: bob },
      'general wisdom',
      { user1: 'alice profile', user2: null },
    );
    const text = fullText(blocks);
    expect(text).toContain('# General assessments');
    expect(text).toContain('general wisdom');
    expect(text).toContain('# Witness assessments');
    expect(text).toContain('alice profile');
    expect(text).not.toContain('bob profile');
  });

  it('caps past messages to the most recent within the token budget', () => {
    // 5K tokens/player ≈ 20,000 chars. 30 messages × 1,000 chars = 30K chars.
    const messages = Array.from({ length: 30 }, (_, i) => `msg${i}-`.padEnd(1000, 'x'));
    const chatty = { id: 3, name: 'chatty', messages };
    const blocks = buildCachedBlock({ user1: chatty, user2: bob }, null, { user1: null, user2: null });
    const text = fullText(blocks);
    expect(text).toContain('msg29-');   // most recent kept
    expect(text).not.toContain('msg0-'); // oldest dropped
    const kept = messages.filter(m => text.includes(m.slice(0, 7)));
    expect(kept.length).toBeLessThanOrEqual(20);
    expect(kept.length).toBeGreaterThan(15);
  });

  it('shows the no-prior-messages note for fresh players', () => {
    const fresh = { id: 9, name: 'fresh', messages: [] };
    const blocks = buildCachedBlock({ user1: fresh, user2: bob }, null, { user1: null, user2: null });
    expect(fullText(blocks)).toContain('No prior messages from this player');
  });
});
