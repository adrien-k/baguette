import { describe, it, expect } from 'vitest';
import {
  PI_API_KEY_ENV_VARS,
  isPiApiKeyEnvVar,
  normalizePiApiKeyEnvVar,
  piProviderIdForEnvVar,
} from '../pi-api-key-env-vars.js';

describe('pi-api-key-env-vars', () => {
  it('includes Anthropic and OpenAI env vars from Pi docs', () => {
    const envs = PI_API_KEY_ENV_VARS.map((e) => e.env);
    expect(envs).toContain('ANTHROPIC_API_KEY');
    expect(envs).toContain('OPENAI_API_KEY');
    expect(envs).toContain('OPENROUTER_API_KEY');
  });

  it('rejects unknown env var names', () => {
    expect(isPiApiKeyEnvVar('PATH')).toBe(false);
    expect(isPiApiKeyEnvVar('ANTHROPIC_API_KEY ')).toBe(false);
    expect(() => normalizePiApiKeyEnvVar('ENCRYPTION_KEY')).toThrow(/Invalid Pi API key env var/);
  });

  it('accepts allowlisted env vars', () => {
    expect(normalizePiApiKeyEnvVar('GEMINI_API_KEY')).toBe('GEMINI_API_KEY');
    expect(piProviderIdForEnvVar('OPENAI_API_KEY')).toBe('openai');
    expect(piProviderIdForEnvVar('OPENCODE_GO_API_KEY')).toBe('opencode-go');
    expect(piProviderIdForEnvVar('OPENCODE_API_KEY')).toBe('opencode');
  });

  it('falls back to the anthropic provider when the env var is unset', () => {
    expect(piProviderIdForEnvVar(null)).toBe('anthropic');
    expect(piProviderIdForEnvVar(undefined)).toBe('anthropic');
  });
});
