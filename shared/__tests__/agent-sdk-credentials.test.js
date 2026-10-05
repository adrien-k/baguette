import { describe, it, expect } from 'vitest';
import {
  availableAgentSdks,
  hasAgentSdkCredential,
  resolveAgentSdkKeys,
} from '../agent-sdk-credentials.js';

describe('agent-sdk-credentials', () => {
  it('uses account keys', () => {
    const user = { anthropic_api_key: 'sk-ant', cursor_api_key: null };
    expect(hasAgentSdkCredential('claude', user, null)).toBe(true);
    expect(hasAgentSdkCredential('cursor', user, null)).toBe(false);
    expect(availableAgentSdks(user, null)).toEqual(['claude']);
  });

  it('counts a Claude auth token as a configured credential', () => {
    const user = { anthropic_api_key: null, anthropic_auth_token: 'bearer-token' };
    expect(hasAgentSdkCredential('claude', user, null)).toBe(true);
    expect(availableAgentSdks(user, null)).toEqual(['claude']);
    expect(resolveAgentSdkKeys(user, null).anthropic_auth_token).toBe('bearer-token');
  });

  it('counts a repo auth token as a configured credential', () => {
    const repo = { anthropic_auth_token: 'repo-token' };
    expect(hasAgentSdkCredential('claude', {}, repo)).toBe(true);
    expect(resolveAgentSdkKeys({}, repo).anthropic_auth_token).toBe('repo-token');
  });

  it('falls back to repo keys', () => {
    const user = {};
    const repo = { cursor_api_key: 'cursor-xxx' };
    expect(availableAgentSdks(user, repo)).toEqual(['cursor']);
    expect(resolveAgentSdkKeys(user, repo).cursor_api_key).toBe('cursor-xxx');
  });

  it('prefers repo key over account key', () => {
    const user = { cursor_api_key: 'account' };
    const repo = { cursor_api_key: 'repo' };
    expect(resolveAgentSdkKeys(user, repo).cursor_api_key).toBe('repo');
  });
});
