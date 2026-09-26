import { describe, it, expect } from 'vitest';
import { getGithubToken } from '../agent-settings.js';

describe('getGithubToken', () => {
  it('prefers github_token over access_token', () => {
    expect(getGithubToken({ github_token: 'ghp_pat', access_token: 'ghu_oauth' })).toBe('ghp_pat');
  });

  it('falls back to access_token', () => {
    expect(getGithubToken({ access_token: 'ghu_oauth' })).toBe('ghu_oauth');
  });
});
