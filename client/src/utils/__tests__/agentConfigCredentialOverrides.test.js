import { describe, it, expect } from 'vitest';
import {
  buildAgentConfigCredentialOverrides,
  buildAgentConfigConnectivityRequest,
} from '../agentConfigCredentialOverrides.js';
import { agentConfigSecretPlaceholder } from '../agentConfigSecretPlaceholder.js';

const claudeSchema = {
  envVarOptions: [
    { value: 'ANTHROPIC_API_KEY', label: 'API key' },
    { value: 'ANTHROPIC_AUTH_TOKEN', label: 'Auth token' },
  ],
  defaultEnvVar: 'ANTHROPIC_API_KEY',
  hasApiUrl: true,
  secretPlaceholder: 'sk-ant-…',
};

const cursorSchema = {
  envVarOptions: null,
  defaultEnvVar: null,
  hasApiUrl: false,
  secretPlaceholder: 'cursor-…',
};

const piSchema = {
  envVarOptions: [{ value: 'GROQ_API_KEY', label: 'Groq' }],
  defaultEnvVar: 'ANTHROPIC_API_KEY',
  hasApiUrl: false,
  secretPlaceholder: 'provider API key',
  secretPlaceholderByEnvVar: { LUNAROUTE_API_KEY: 'lr_…' },
};

describe('buildAgentConfigCredentialOverrides', () => {
  it('includes api_url only when the schema hasApiUrl', () => {
    expect(
      buildAgentConfigCredentialOverrides({
        schema: claudeSchema,
        savedConfig: { api_url: '' },
        apiUrl: 'https://gw.example',
        apiKey: null,
        apiKeyDirty: false,
        apiKeyEnvVar: 'ANTHROPIC_API_KEY',
      })
    ).toEqual({ api_url: 'https://gw.example' });
    expect(
      buildAgentConfigCredentialOverrides({
        schema: cursorSchema,
        savedConfig: null,
        apiUrl: 'https://gw.example',
        apiKey: 'k',
        apiKeyDirty: true,
        apiKeyEnvVar: '',
      })
    ).toEqual({ api_key: 'k' });
  });

  it('includes api_key_env_var when env var options change', () => {
    expect(
      buildAgentConfigCredentialOverrides({
        schema: piSchema,
        savedConfig: { api_key_env_var: 'ANTHROPIC_API_KEY' },
        apiUrl: '',
        apiKey: null,
        apiKeyDirty: false,
        apiKeyEnvVar: 'GROQ_API_KEY',
      })
    ).toEqual({ api_key_env_var: 'GROQ_API_KEY' });
  });
});

describe('buildAgentConfigConnectivityRequest', () => {
  it('sends sdk for drafts and id for saved rows', () => {
    expect(
      buildAgentConfigConnectivityRequest({
        sdk: 'claude',
        schema: claudeSchema,
        savedConfig: null,
        apiUrl: '',
        apiKey: 'sk',
        apiKeyDirty: true,
        apiKeyEnvVar: 'ANTHROPIC_API_KEY',
        agentConfigId: null,
      })
    ).toMatchObject({ sdk: 'claude', api_key: 'sk' });
    expect(
      buildAgentConfigConnectivityRequest({
        sdk: 'claude',
        schema: claudeSchema,
        savedConfig: { id: 3 },
        apiUrl: '',
        apiKey: '',
        apiKeyDirty: false,
        apiKeyEnvVar: 'ANTHROPIC_API_KEY',
        agentConfigId: 3,
      })
    ).toMatchObject({ id: 3 });
  });
});

describe('agentConfigSecretPlaceholder', () => {
  it('uses schema placeholders including per-env-var overrides', () => {
    expect(agentConfigSecretPlaceholder(cursorSchema, null)).toBe('cursor-…');
    expect(agentConfigSecretPlaceholder(piSchema, 'LUNAROUTE_API_KEY')).toBe('lr_…');
    expect(agentConfigSecretPlaceholder(piSchema, 'GROQ_API_KEY')).toBe('provider API key');
  });
});
