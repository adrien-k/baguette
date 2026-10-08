import { describe, it, expect } from 'vitest';
import { resolvePiCredentials } from '../pi/pi-config.js';
import { DEFAULT_PI_API_KEY_ENV_VAR } from '../../../shared/pi-api-key-env-vars.js';

describe('resolvePiCredentials', () => {
  it('reads api_key and env var directly from an agent config row', () => {
    expect(
      resolvePiCredentials({ sdk: 'pi', api_key: 'pi-key', api_key_env_var: 'GROQ_API_KEY' })
    ).toEqual({ apiKey: 'pi-key', envVar: 'GROQ_API_KEY', providerId: 'groq' });
  });

  it('uses the default env var (Anthropic) when api_key_env_var is unset', () => {
    expect(resolvePiCredentials({ sdk: 'pi', api_key: 'sk-pi', api_key_env_var: null })).toEqual({
      apiKey: 'sk-pi',
      envVar: DEFAULT_PI_API_KEY_ENV_VAR,
      providerId: 'anthropic',
    });
  });

  it('does not route anthropic env vars away from pi', () => {
    expect(
      resolvePiCredentials({ sdk: 'pi', api_key: 'sk-pi', api_key_env_var: 'ANTHROPIC_AUTH_TOKEN' })
    ).toEqual({ apiKey: 'sk-pi', envVar: 'ANTHROPIC_AUTH_TOKEN', providerId: 'anthropic' });
  });

  it('returns null apiKey when config is null or has no key', () => {
    expect(resolvePiCredentials(null)).toEqual({
      apiKey: null,
      envVar: DEFAULT_PI_API_KEY_ENV_VAR,
      providerId: 'anthropic',
    });
    expect(resolvePiCredentials({ sdk: 'pi', api_key: null, api_key_env_var: null }).apiKey).toBe(
      null
    );
  });
});
