import { describe, expect, it } from 'vitest';
import { sessionPlanTitle } from '../sessionPlanDisplay.ts';

describe('sessionPlanTitle', () => {
  it('uses the first ATX heading', () => {
    expect(
      sessionPlanTitle({
        ref: 2,
        markdown: 'Preamble\n\n# Ship plan links\n\n## Steps',
      })
    ).toBe('Ship plan links');
  });

  it('falls back to the first non-empty line', () => {
    expect(sessionPlanTitle({ ref: 1, markdown: '\nDo the thing\n\nMore' })).toBe('Do the thing');
  });

  it('falls back to Plan #ref when markdown is empty', () => {
    expect(sessionPlanTitle({ ref: 3, markdown: '' })).toBe('Plan #3');
    expect(sessionPlanTitle({ ref: null, markdown: null })).toBe('Plan');
  });
});
