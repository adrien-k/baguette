import { describe, it, expect } from 'vitest';
import {
  duplicateRepoDisplayNames,
  formatRepoLabel,
  groupReposByOrg,
  repoOrg,
} from '../repoDisplayName.js';

describe('repoOrg', () => {
  it('returns the owner for GitHub full names', () => {
    expect(repoOrg('acme/app')).toBe('acme');
  });

  it('treats path and bare names as Local', () => {
    expect(repoOrg('/home/me/proj')).toBe('Local');
    expect(repoOrg('scratch')).toBe('Local');
  });
});

describe('duplicateRepoDisplayNames', () => {
  it('marks names that appear on more than one repo', () => {
    const dupes = duplicateRepoDisplayNames(['acme/app', 'other/app', 'acme/unique']);
    expect(dupes.has('app')).toBe(true);
    expect(dupes.has('unique')).toBe(false);
  });
});

describe('formatRepoLabel', () => {
  const noDupes = duplicateRepoDisplayNames(['acme/app']);
  const withDupes = duplicateRepoDisplayNames(['acme/app', 'other/app']);

  it('shows only the repo name when the short name is unique', () => {
    expect(formatRepoLabel('acme/app', noDupes)).toBe('app');
  });

  it('shows org and repo name when the short name is duplicated', () => {
    expect(formatRepoLabel('acme/app', withDupes)).toBe('acme / app');
    expect(formatRepoLabel('other/app', withDupes)).toBe('other / app');
  });

  it('uses Local for path repos when duplicated', () => {
    const dupes = duplicateRepoDisplayNames(['/tmp/a', '/var/a']);
    expect(formatRepoLabel('/tmp/a', dupes)).toBe('Local / a');
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
