import { describe, it, expect } from 'vitest';
import { sessionListPromptPreview } from '../sessionListDisplay.js';

describe('sessionListPromptPreview', () => {
  it('prefers pr_description over initial_prompt', () => {
    const preview = sessionListPromptPreview({
      pr_description: '## Summary\n- Ship it',
      initial_prompt: 'Original ask',
    });
    expect(preview).toContain('Summary');
    expect(preview).not.toContain('Original');
  });

  it('falls back to initial_prompt when description is empty', () => {
    expect(
      sessionListPromptPreview({
        pr_description: '   ',
        initial_prompt: 'Original ask',
      })
    ).toBe('Original ask');
  });
});
