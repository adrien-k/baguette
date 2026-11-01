import { describe, it, expect } from 'vitest';
import {
  ANTHROPIC_API_KEY_ENV,
  CLAUDE_API_KEY_ENV_OPTIONS,
  defaultAgentConfigApiKeyEnvVar,
  normalizeAgentConfigApiKeyEnvVar,
  PI_API_KEY_ENV_VARS,
} from '../agent-config-api-key-env.js';
import { DEFAULT_PI_API_KEY_ENV_VAR } from '../pi-api-key-env-vars.js';

const claudeSchema = {
  envVarOptions: CLAUDE_API_KEY_ENV_OPTIONS,
  defaultEnvVar: ANTHROPIC_API_KEY_ENV,
};
const cursorSchema = { envVarOptions: null, defaultEnvVar: null };
const piSchema = {
  envVarOptions: PI_API_KEY_ENV_VARS.map((e) => ({ value: e.env, label: e.label })),
  defaultEnvVar: DEFAULT_PI_API_KEY_ENV_VAR,
};
const mockSchema = { envVarOptions: null, defaultEnvVar: null };

describe('agent-config-api-key-env', () => {
  it('stores null when schema has no env var options', () => {
    expect(defaultAgentConfigApiKeyEnvVar(cursorSchema)).toBeNull();
    expect(normalizeAgentConfigApiKeyEnvVar(cursorSchema, 'CURSOR_API_KEY')).toBeNull();
    expect(defaultAgentConfigApiKeyEnvVar(mockSchema)).toBeNull();
    expect(normalizeAgentConfigApiKeyEnvVar(mockSchema, 'ANY')).toBeNull();
    expect(defaultAgentConfigApiKeyEnvVar(null)).toBeNull();
  });

  it('claude schema accepts api key or auth token env names', () => {
    expect(defaultAgentConfigApiKeyEnvVar(claudeSchema)).toBe(ANTHROPIC_API_KEY_ENV);
    expect(normalizeAgentConfigApiKeyEnvVar(claudeSchema, 'ANTHROPIC_API_KEY')).toBe(
      'ANTHROPIC_API_KEY'
    );
    expect(normalizeAgentConfigApiKeyEnvVar(claudeSchema, 'ANTHROPIC_AUTH_TOKEN')).toBe(
      'ANTHROPIC_AUTH_TOKEN'
    );
  });

  it('pi schema normalizes allowed env vars', () => {
    expect(normalizeAgentConfigApiKeyEnvVar(piSchema, 'GROQ_API_KEY')).toBe('GROQ_API_KEY');
    expect(normalizeAgentConfigApiKeyEnvVar(piSchema, '')).toBe(DEFAULT_PI_API_KEY_ENV_VAR);
  });

  it('rejects env vars not listed on the schema', () => {
    expect(() => normalizeAgentConfigApiKeyEnvVar(claudeSchema, 'NOPE')).toThrow(
      /Invalid API key env var/
    );
  });
});
