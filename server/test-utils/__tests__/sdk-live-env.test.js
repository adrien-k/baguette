import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ANTHROPIC_AUTH_TOKEN_ENV } from '../../../shared/agent-config-api-key-env.js';
import { MOCK_STANDARD_MODEL_ID } from '../../../shared/mock-agent-sdk.js';
import { DEFAULT_LIVE_TIMEOUT_MS, readLiveSdkEnv } from '../sdk-live-env.js';

describe('readLiveSdkEnv', () => {
  beforeEach(() => {
    for (const key of [
      'SDK_TESTS_MOCK',
      'SDK_TESTS_TIMEOUT_MS',
      'SDK_TESTS_CLAUDE_API_KEY',
      'SDK_TESTS_CLAUDE_AUTH_TOKEN',
      'SDK_TESTS_CLAUDE_MODEL',
      'SDK_TESTS_CLAUDE_API_URL',
      'SDK_TESTS_CURSOR_API_KEY',
      'SDK_TESTS_CURSOR_MODEL',
      'SDK_TESTS_CURSOR_MODEL_PARAMS',
      'SDK_TESTS_PI_API_KEY',
      'SDK_TESTS_PI_MODEL',
      'SDK_TESTS_PI_API_KEY_ENV_VAR',
    ]) {
      vi.stubEnv(key, '');
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('disables claude when key or model is missing', () => {
    vi.stubEnv('SDK_TESTS_CLAUDE_API_KEY', '');
    vi.stubEnv('SDK_TESTS_CLAUDE_MODEL', 'sonnet');
    expect(readLiveSdkEnv('claude').enabled).toBe(false);

    vi.stubEnv('SDK_TESTS_CLAUDE_API_KEY', 'sk-ant-test');
    vi.stubEnv('SDK_TESTS_CLAUDE_MODEL', '');
    expect(readLiveSdkEnv('claude').enabled).toBe(false);
  });

  it('enables claude when API key and model are set', () => {
    vi.stubEnv('SDK_TESTS_CLAUDE_API_KEY', 'sk-ant-test');
    vi.stubEnv('SDK_TESTS_CLAUDE_MODEL', 'haiku');
    vi.stubEnv('SDK_TESTS_CLAUDE_API_URL', 'https://example.test');
    const env = readLiveSdkEnv('claude');
    expect(env.enabled).toBe(true);
    expect(env.apiKey).toBe('sk-ant-test');
    expect(env.model).toBe('haiku');
    expect(env.apiUrl).toBe('https://example.test');
    expect(env.timeoutMs).toBe(DEFAULT_LIVE_TIMEOUT_MS);
  });

  it('treats a Claude auth token as the secret', () => {
    vi.stubEnv('SDK_TESTS_CLAUDE_API_KEY', '');
    vi.stubEnv('SDK_TESTS_CLAUDE_AUTH_TOKEN', 'tok-test');
    vi.stubEnv('SDK_TESTS_CLAUDE_MODEL', 'sonnet');
    const env = readLiveSdkEnv('claude');
    expect(env.enabled).toBe(true);
    expect(env.apiKey).toBe('tok-test');
    expect(env.apiKeyEnvVar).toBe(ANTHROPIC_AUTH_TOKEN_ENV);
  });

  it('defaults cursor model_params to an empty JSON array', () => {
    vi.stubEnv('SDK_TESTS_CURSOR_API_KEY', 'cursor-key');
    vi.stubEnv('SDK_TESTS_CURSOR_MODEL', 'grok-4.5');
    const env = readLiveSdkEnv('cursor');
    expect(env.enabled).toBe(true);
    expect(env.modelParams).toBe('[]');
  });

  it('forwards the Pi key env var', () => {
    vi.stubEnv('SDK_TESTS_PI_API_KEY', 'openai-key');
    vi.stubEnv('SDK_TESTS_PI_MODEL', 'gpt-4.1');
    vi.stubEnv('SDK_TESTS_PI_API_KEY_ENV_VAR', 'OPENAI_API_KEY');
    const env = readLiveSdkEnv('pi');
    expect(env.enabled).toBe(true);
    expect(env.apiKeyEnvVar).toBe('OPENAI_API_KEY');
  });

  it('enables mock only for an explicit flag', () => {
    expect(readLiveSdkEnv('mock').enabled).toBe(false);
    vi.stubEnv('SDK_TESTS_MOCK', '1');
    const env = readLiveSdkEnv('mock');
    expect(env.enabled).toBe(true);
    expect(env.model).toBe(MOCK_STANDARD_MODEL_ID);
  });

  it('parses SDK_TESTS_TIMEOUT_MS', () => {
    vi.stubEnv('SDK_TESTS_CLAUDE_API_KEY', 'sk');
    vi.stubEnv('SDK_TESTS_CLAUDE_MODEL', 'haiku');
    vi.stubEnv('SDK_TESTS_TIMEOUT_MS', '45000');
    expect(readLiveSdkEnv('claude').timeoutMs).toBe(45000);
  });
});
