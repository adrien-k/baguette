import { describe, it, expect } from 'vitest';
import { combinePromptExtensions } from '../agent-prompts.js';

describe('combinePromptExtensions', () => {
  it('joins non-empty parts with blank lines', () => {
    expect(combinePromptExtensions('Global', 'Repo-specific')).toBe('Global\n\nRepo-specific');
  });

  it('skips empty and whitespace-only parts', () => {
    expect(combinePromptExtensions('  only  ', '', null, undefined)).toBe('only');
  });
});
