import { describe, it, expect } from 'vitest';
import { resolveAgentSdkKeys } from '../agent-sdk-credentials.js';

describe('resolveAgentSdkKeys', () => {
  it('uses account keys', () => {
    const user = { anthropic_api_key: 'sk-ant', cursor_api_key: null };
    expect(resolveAgentSdkKeys(user, null)).toEqual({
      anthropic_api_key: 'sk-ant',
      anthropic_auth_token: null,
      cursor_api_key: null,
      pi_api_key: null,
      pi_api_key_env_var: null,
    });
  });

  it('counts a Claude auth token as a configured credential', () => {
    const user = { anthropic_api_key: null, anthropic_auth_token: 'bearer-token' };
    expect(resolveAgentSdkKeys(user, null).anthropic_auth_token).toBe('bearer-token');
  });

  it('counts a repo auth token as a configured credential', () => {
    const repo = { anthropic_auth_token: 'repo-token' };
    expect(resolveAgentSdkKeys({}, repo).anthropic_auth_token).toBe('repo-token');
  });

  it('falls back to repo keys', () => {
    const user = {};
    const repo = { cursor_api_key: 'cursor-xxx' };
    expect(resolveAgentSdkKeys(user, repo).cursor_api_key).toBe('cursor-xxx');
  });

  it('prefers repo key over account key', () => {
    const user = { cursor_api_key: 'account' };
    const repo = { cursor_api_key: 'repo' };
    expect(resolveAgentSdkKeys(user, repo).cursor_api_key).toBe('repo');
  });
});
