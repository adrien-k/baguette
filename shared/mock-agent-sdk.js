export const MOCK_AGENT_SUMMARY_TEXT =
  'Simulated turn complete — exercised every tool kind (files, shell, todos, task, questions, plan, MCP, generic).';

export const MOCK_REVIEWER_SUMMARY_TEXT =
  'Mock review complete — filed sample issues for UI and e2e coverage.';

/** Deterministic titles created by the mock reviewer turn (Issues tab). */
export const MOCK_REVIEW_ISSUES = [
  {
    severity: 'high',
    title: 'Mock review: missing error handling',
    description: 'Simulated finding from the mock reviewer agent.',
  },
  {
    severity: 'medium',
    title: 'Mock review: unclear naming',
    description: 'Second simulated issue for list and severity UI.',
  },
];

/** Shown in chat assertions and the mock model list. */
export const MOCK_STANDARD_MODEL_ID = 'mock-standard';

/** True when `ENABLE_MOCK_AGENT=true` (server Node, or client via Vite `VITE_ENABLE_MOCK_AGENT`). */
export function isMockAgentSdkEnabled() {
  if (typeof process !== 'undefined' && process.env.ENABLE_MOCK_AGENT === 'true') {
    return true;
  }
  return typeof import.meta !== 'undefined' && import.meta.env?.VITE_ENABLE_MOCK_AGENT === 'true';
}

export function listMockModels() {
  if (!isMockAgentSdkEnabled()) return [];
  return [
    {
      id: MOCK_STANDARD_MODEL_ID,
      display_name: 'Mock Standard',
      variants: [
        {
          display_name: 'Normal',
          is_default: true,
          params: [{ id: 'verbosity', value: 'normal' }],
        },
        {
          display_name: 'Verbose',
          is_default: false,
          params: [{ id: 'verbosity', value: 'verbose' }],
        },
      ],
    },
  ];
}
