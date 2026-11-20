import { describe, it, expect } from 'vitest';
import { titleFromPrompt } from '../agent-naming.js';

describe('titleFromPrompt', () => {
  it('uses the first four words', () => {
    expect(titleFromPrompt('one two three four five')).toBe('one two three four');
  });

  it('falls back to Builder for empty prompts', () => {
    expect(titleFromPrompt('   ')).toBe('Builder');
  });
});
