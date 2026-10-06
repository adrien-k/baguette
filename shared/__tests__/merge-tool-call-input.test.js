import { describe, it, expect } from 'vitest';
import { mergeToolCallInput } from '../merge-tool-call-input.js';

describe('mergeToolCallInput', () => {
  it('keeps a non-empty command when a later frame sends an empty string', () => {
    expect(mergeToolCallInput({ command: 'echo test' }, { command: '', description: 'x' })).toEqual(
      { command: 'echo test', description: 'x' }
    );
  });

  it('fills in command from a later frame', () => {
    expect(mergeToolCallInput({ command: '' }, { command: 'echo test' })).toEqual({
      command: 'echo test',
    });
  });
});
