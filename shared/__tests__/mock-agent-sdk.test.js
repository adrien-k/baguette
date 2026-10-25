import { describe, expect, it } from 'vitest';

import {
  MOCK_E2E_CREATE_PLAN_NON_INTERACTIVE_PROMPT,
  MOCK_E2E_CREATE_PLAN_PROMPT,
  mockAgentScenarioForPrompt,
} from '../mock-agent-sdk.js';

describe('mockAgentScenarioForPrompt', () => {
  it('distinguishes non-interactive plan from interactive plan-create', () => {
    expect(mockAgentScenarioForPrompt(MOCK_E2E_CREATE_PLAN_NON_INTERACTIVE_PROMPT)).toBe(
      'plan-create-non-interactive'
    );
    expect(mockAgentScenarioForPrompt(MOCK_E2E_CREATE_PLAN_PROMPT)).toBe('plan-create');
  });
});
