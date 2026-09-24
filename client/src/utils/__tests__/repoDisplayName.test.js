import { describe, it, expect } from 'vitest';
import { formatRepoLabel, groupReposByOrg, repoOrg } from '../repoDisplayName.js';

describe('repoOrg', () => {
  it('returns the owner for GitHub full names', () => {
    expect(repoOrg('acme/app')).toBe('acme');
  });

  it('treats path and bare names as Local', () => {
    expect(repoOrg('/home/me/proj')).toBe('Local');
    expect(repoOrg('scratch')).toBe('Local');
  });
});

describe('formatRepoLabel', () => {
  it('shows org and repo name', () => {
    expect(formatRepoLabel('acme/app')).toBe('acme / app');
  });

  it('uses Local for path repos', () => {
    expect(formatRepoLabel('/tmp/local')).toBe('Local / local');
  });
});

describe('groupReposByOrg', () => {
  it('groups by org, keeps first-seen order, and puts Local last', () => {
    const repos = [
      { id: 1, full_name: 'zeta/one' },
      { id: 2, full_name: 'acme/two' },
      { id: 3, full_name: 'zeta/three' },
      { id: 4, full_name: '/tmp/local' },
      { id: 5, full_name: 'acme/four' },
    ];
    expect(groupReposByOrg(repos).map((g) => g.org)).toEqual(['zeta', 'acme', 'Local']);
    expect(groupReposByOrg(repos)[0].repos.map((r) => r.id)).toEqual([1, 3]);
    expect(groupReposByOrg(repos)[1].repos.map((r) => r.id)).toEqual([2, 5]);
    expect(groupReposByOrg(repos)[2].repos.map((r) => r.id)).toEqual([4]);
  });
});
