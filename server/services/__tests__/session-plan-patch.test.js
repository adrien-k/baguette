import { describe, it, expect } from 'vitest';
import { applySessionPlanPatches } from '../session-plan-patch.js';

describe('applySessionPlanPatches', () => {
  it('applies a single patch', () => {
    const out = applySessionPlanPatches('## Goals\n- A\n', [
      { old_string: '- A', new_string: '- B' },
    ]);
    expect(out).toBe('## Goals\n- B');
  });

  it('applies patches in order', () => {
    const out = applySessionPlanPatches('one two three', [
      { old_string: 'one', new_string: '1' },
      { old_string: 'two', new_string: '2' },
    ]);
    expect(out).toBe('1 2 three');
  });

  it('allows deletion via empty new_string', () => {
    const out = applySessionPlanPatches('keep remove tail', [
      { old_string: ' remove', new_string: '' },
    ]);
    expect(out).toBe('keep tail');
  });

  it('throws when old_string is missing', () => {
    expect(() => applySessionPlanPatches('x', [{ old_string: 'y', new_string: 'z' }])).toThrow(
      /not found/
    );
  });
});
