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
export const MOCK_SECONDARY_MODEL_ID = 'mock-secondary';
export const MOCK_CATALOG_ALT_API_KEY = 'mock-catalog-alt';
export const MOCK_ALT_PRIMARY_MODEL_ID = 'mock-alt-primary';

export const MOCK_E2E_CONFIG_A_LABEL = 'Mock E2E A';
export const MOCK_E2E_CONFIG_B_LABEL = 'Mock E2E B';
export const MOCK_E2E_SUBAGENT_PRESET_DESCRIPTION = 'e2e subagent preset';

/** E2e / dev: short mock turn (manual extra builders, subagent initial prompt). */
export const MOCK_E2E_QUICK_TURN_PROMPT = 'e2e quick mock turn';
export const MOCK_E2E_QUICK_TURN_SUMMARY = 'E2E quick mock turn complete.';

/** E2e: primary builder simulates MCP StartSubagent when user sends this phrase. */
export const MOCK_E2E_SUBAGENT_PROMPT = 'create a subagent for e2e tests';
export const MOCK_E2E_SUBAGENT_SUMMARY = 'E2E subagent started via MCP (StartSubagent).';
export const MOCK_E2E_SUBAGENT_NAME = 'E2E MCP subagent';

/**
 * @param {object | null | undefined} parsed - normalized user payload (`normalizeUserPayloadForStorage`)
 */
export function mockUserPromptText(parsed) {
  if (!parsed || parsed.type !== 'user') return '';
  if (typeof parsed.content === 'string') return parsed.content.trim();
  if (Array.isArray(parsed.content)) {
    return parsed.content
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n')
      .trim();
  }
  const legacy = parsed.message?.content;
  if (typeof legacy === 'string') return legacy.trim();
  if (Array.isArray(legacy)) {
    return legacy
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n')
      .trim();
  }
  return '';
}

/** @returns {'full' | 'quick' | 'subagent-e2e'} */
export function mockAgentScenarioForPrompt(promptText) {
  const text = (promptText ?? '').trim().toLowerCase();
  if (text.includes(MOCK_E2E_SUBAGENT_PROMPT.toLowerCase())) return 'subagent-e2e';
  if (text.includes(MOCK_E2E_QUICK_TURN_PROMPT.toLowerCase())) return 'quick';
  return 'full';
}

/** True when `ENABLE_MOCK_AGENT=true` (server Node, or client via Vite `VITE_ENABLE_MOCK_AGENT`). */
export function isMockAgentSdkEnabled() {
  if (typeof process !== 'undefined' && process.env.ENABLE_MOCK_AGENT === 'true') {
    return true;
  }
  return typeof import.meta !== 'undefined' && import.meta.env?.VITE_ENABLE_MOCK_AGENT === 'true';
}

function defaultMockCatalog() {
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
    {
      id: MOCK_SECONDARY_MODEL_ID,
      display_name: 'Mock Secondary',
      variants: [
        {
          display_name: 'Normal',
          is_default: true,
          params: [{ id: 'verbosity', value: 'normal' }],
        },
      ],
    },
  ];
}

function altMockCatalog() {
  return [
    {
      id: MOCK_ALT_PRIMARY_MODEL_ID,
      display_name: 'Mock Alt Primary',
      variants: [
        {
          display_name: 'Normal',
          is_default: true,
          params: [{ id: 'verbosity', value: 'normal' }],
        },
      ],
    },
  ];
}

/**
 * @param {string | null | undefined} catalogKey — mock agent_configs api_key (fake catalog id).
 */
export function listMockModels(catalogKey) {
  if (!isMockAgentSdkEnabled()) return [];
  const key = (catalogKey ?? '').trim();
  if (key === MOCK_CATALOG_ALT_API_KEY) return altMockCatalog();
  return defaultMockCatalog();
}
