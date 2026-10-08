import { describe, it, expect } from 'vitest';
import {
  defaultAgentConfigApiKeyEnvVar,
  normalizeAgentConfigApiKeyEnvVar,
} from '../agent-config-api-key-env.js';

describe('agent-config-api-key-env', () => {
  it('cursor stores null env var', () => {
    expect(defaultAgentConfigApiKeyEnvVar('cursor')).toBeNull();
    expect(normalizeAgentConfigApiKeyEnvVar('cursor', 'CURSOR_API_KEY')).toBeNull();
  });

  it('claude accepts api key or auth token env names', () => {
    expect(normalizeAgentConfigApiKeyEnvVar('claude', 'ANTHROPIC_API_KEY')).toBe(
      'ANTHROPIC_API_KEY'
    );
    expect(normalizeAgentConfigApiKeyEnvVar('claude', 'ANTHROPIC_AUTH_TOKEN')).toBe(
      'ANTHROPIC_AUTH_TOKEN'
    );
  });

  it('pi normalizes allowed env vars', () => {
    expect(normalizeAgentConfigApiKeyEnvVar('pi', 'GROQ_API_KEY')).toBe('GROQ_API_KEY');
  });

  it('mock stores null env var', () => {
    expect(defaultAgentConfigApiKeyEnvVar('mock')).toBeNull();
    expect(normalizeAgentConfigApiKeyEnvVar('mock', 'ANY')).toBeNull();
  });
});
