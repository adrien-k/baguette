import { describe, it, expect } from 'vitest';
import { gitHubOriginFromFullName, isLocalRepo, isLocalRepoFullName } from '../repo-origin.js';

describe('gitHubOriginFromFullName', () => {
  it('builds a GitHub HTTPS URL for owner/repo names', () => {
    expect(gitHubOriginFromFullName('acme/app')).toBe('https://github.com/acme/app.git');
  });

  it('returns null for local full_name shapes', () => {
    expect(gitHubOriginFromFullName('my-project')).toBeNull();
    expect(gitHubOriginFromFullName('/home/me/proj')).toBeNull();
    expect(gitHubOriginFromFullName('')).toBeNull();
  });
});

describe('isLocalRepo', () => {
  it('uses origin when present on a repo row', () => {
    expect(isLocalRepo({ origin: 'https://github.com/acme/app.git', full_name: 'acme/app' })).toBe(
      false
    );
    expect(isLocalRepo({ origin: null, full_name: 'acme/app' })).toBe(true);
    expect(isLocalRepo({ origin: null, full_name: 'scratch' })).toBe(true);
  });

  it('falls back to full_name convention for strings', () => {
    expect(isLocalRepo('acme/app')).toBe(false);
    expect(isLocalRepo('my-project')).toBe(true);
    expect(isLocalRepoFullName('')).toBe(true);
  });
});
