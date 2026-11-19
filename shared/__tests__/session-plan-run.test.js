import { describe, expect, it } from 'vitest';
import { RUN_PLAN_USER_MESSAGE, runPlanUserMessage } from '../session-plan-run.js';

describe('runPlanUserMessage', () => {
  it('returns the default proceed message without a ref', () => {
    expect(runPlanUserMessage()).toBe(RUN_PLAN_USER_MESSAGE);
    expect(runPlanUserMessage(null)).toBe(RUN_PLAN_USER_MESSAGE);
  });

  it('includes the plan ref when set', () => {
    expect(runPlanUserMessage(2)).toBe('Proceed with plan #2.');
  });
});
