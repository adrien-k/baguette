import { describe, it, expect } from 'vitest';
import {
  applyCredentialOverridesToConfig,
  credentialOverridesFromQuery,
  draftAgentConfigForConnectivityTest,
  resolveListModelsRequest,
} from '../agent-config-credential-overrides.js';

describe('agent-config-credential-overrides', () => {
  it('parses config column keys only', () => {
    expect(
      credentialOverridesFromQuery({
        api_url: 'https://gw.example',
        api_key: 'sk-test',
        id: '1',
        refresh: 'true',
      })
    ).toEqual({ api_url: 'https://gw.example', api_key: 'sk-test' });
  });

  it('ignores legacy flat-key override names', () => {
    expect(
      credentialOverridesFromQuery({
        anthropic_base_url: 'https://gw.example',
        anthropic_api_key: 'sk-legacy',
        cursor_api_key: 'cursor-key',
        pi_api_key: 'pi-key',
        pi_api_key_env_var: 'GROQ_API_KEY',
      })
    ).toEqual({});
  });

  it('applies config column overrides to config', () => {
    const config = { api_url: null, api_key: 'old', api_key_env_var: 'ANTHROPIC_API_KEY' };
    const next = applyCredentialOverridesToConfig(config, {
      api_url: 'https://gw.example',
      api_key: 'token',
      api_key_env_var: 'ANTHROPIC_AUTH_TOKEN',
    });
    expect(next.api_url).toBe('https://gw.example');
    expect(next.api_key).toBe('token');
    expect(next.api_key_env_var).toBe('ANTHROPIC_AUTH_TOKEN');
  });

  it('overwrites with null when overriding with empty strings', () => {
    const config = {
      api_url: 'https://gw.example',
      api_key: 'old',
      api_key_env_var: 'GROQ_API_KEY',
    };
    const next = applyCredentialOverridesToConfig(config, {
      api_url: '',
      api_key: '',
      api_key_env_var: '',
    });
    expect(next.api_url).toBeNull();
    expect(next.api_key).toBeNull();
    expect(next.api_key_env_var).toBeNull();
  });

  it('builds draft config for unsaved connectivity tests', () => {
    const draft = draftAgentConfigForConnectivityTest('claude', {
      api_key: 'sk-test',
    });
    expect(draft.sdk).toBe('claude');
    expect(draft.api_key).toBe('sk-test');
  });

  it('accepts config column overrides', () => {
    const draft = draftAgentConfigForConnectivityTest('claude', {
      api_key: 'sk-col',
      api_url: 'https://gw.example',
      api_key_env_var: 'ANTHROPIC_API_KEY',
    });
    expect(draft.api_key).toBe('sk-col');
    expect(draft.api_url).toBe('https://gw.example');
  });

  it('resolveListModelsRequest reads credential overrides from body only', () => {
    const req = resolveListModelsRequest(
      { id: 3, api_key: 'from-body', refresh: true },
      { api_key: 'from-query', refresh: 'true' }
    );
    expect(req.id).toBe(3);
    expect(req.refresh).toBe(true);
    expect(req.credentialOverrides).toEqual({ api_key: 'from-body' });
  });

  it('resolveListModelsRequest allows id and sdk from query when body omits them', () => {
    const req = resolveListModelsRequest(null, { id: '7', sdk: 'claude' });
    expect(req.id).toBe('7');
    expect(req.sdk).toBe('claude');
    expect(req.credentialOverrides).toEqual({});
  });
});
