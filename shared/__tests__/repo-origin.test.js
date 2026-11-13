import { describe, it, expect } from 'vitest';
import {
  autoPushEnabledForRepo,
  gitAuthFromRepo,
  gitHubOriginFromFullName,
  githubApiAvailable,
  inferFullNameFromOrigin,
  isLocalRepo,
  isLocalRepoFullName,
  parseGitRemoteOrigin,
  repoAccessMode,
  repoAccessModeLabel,
} from '../repo-origin.js';

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

describe('parseGitRemoteOrigin', () => {
  it('parses scp-style SSH remotes', () => {
    expect(parseGitRemoteOrigin('git@github.com:acme/app.git')).toEqual({
      scheme: 'ssh',
      host: 'github.com',
      path: 'acme/app',
      origin: 'git@github.com:acme/app.git',
    });
  });

  it('parses ssh:// remotes', () => {
    expect(parseGitRemoteOrigin('ssh://git@gitlab.com/acme/app.git')).toEqual({
      scheme: 'ssh',
      host: 'gitlab.com',
      path: 'acme/app',
      origin: 'ssh://git@gitlab.com/acme/app.git',
    });
  });

  it('parses HTTPS remotes', () => {
    expect(parseGitRemoteOrigin('https://github.com/acme/app.git')).toEqual({
      scheme: 'https',
      host: 'github.com',
      path: 'acme/app',
      origin: 'https://github.com/acme/app.git',
    });
  });

  it('returns null for empty or invalid values', () => {
    expect(parseGitRemoteOrigin('')).toBeNull();
    expect(parseGitRemoteOrigin('not-a-remote')).toBeNull();
    expect(parseGitRemoteOrigin(null)).toBeNull();
  });
});

describe('inferFullNameFromOrigin', () => {
  it('takes the last two path segments without .git', () => {
    expect(inferFullNameFromOrigin('git@github.com:acme/app.git')).toBe('acme/app');
    expect(inferFullNameFromOrigin('ssh://git@host/group/acme/app.git')).toBe('acme/app');
  });

  it('returns null when the path has fewer than two segments', () => {
    expect(inferFullNameFromOrigin('git@host:app.git')).toBeNull();
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

  it('treats access_mode local as local', () => {
    expect(isLocalRepo({ access_mode: 'local', origin: null, full_name: 'scratch' })).toBe(true);
  });

  it('falls back to full_name convention for strings', () => {
    expect(isLocalRepo('acme/app')).toBe(false);
    expect(isLocalRepo('my-project')).toBe(true);
    expect(isLocalRepoFullName('')).toBe(true);
  });

  it('does not treat scp-style SSH URLs as local', () => {
    expect(isLocalRepo('git@host:path')).toBe(false);
    expect(isLocalRepo('git@gitlab.com:acme/app.git')).toBe(false);
  });
});

describe('autoPushEnabledForRepo', () => {
  it('stays on for github remotes', () => {
    expect(
      autoPushEnabledForRepo('acme/app', true, {
        access_mode: 'github',
        origin: 'https://github.com/acme/app.git',
        full_name: 'acme/app',
      })
    ).toBe(true);
  });

  it('is forced off for local repos', () => {
    expect(autoPushEnabledForRepo('scratch', true, { access_mode: 'local', origin: null })).toBe(
      false
    );
    expect(autoPushEnabledForRepo('scratch', true)).toBe(false);
  });
});

describe('githubApiAvailable / gitAuthFromRepo', () => {
  it('requires a token and github.com host', () => {
    expect(githubApiAvailable({ token: 'tok', origin: 'https://github.com/acme/app.git' })).toBe(
      true
    );
    expect(githubApiAvailable({ token: 'tok', origin: 'git@github.com:acme/app.git' })).toBe(true);
    expect(githubApiAvailable({ token: 'tok', origin: 'git@gitlab.com:acme/app.git' })).toBe(false);
    expect(githubApiAvailable({ token: null, origin: 'https://github.com/acme/app.git' })).toBe(
      false
    );
  });

  it('builds local auth when there is no origin', () => {
    expect(
      gitAuthFromRepo({ access_mode: 'local', origin: null }, { token: 'tok', userId: 1 })
    ).toEqual({ mode: 'local', token: null, userId: 1 });
  });
});

describe('repoAccessMode', () => {
  it('labels github and local', () => {
    expect(repoAccessMode({ access_mode: 'github' })).toBe('github');
    expect(repoAccessMode({ access_mode: 'local' })).toBe('local');
    expect(repoAccessModeLabel({ access_mode: 'github' })).toBe('GitHub');
    expect(repoAccessModeLabel({ access_mode: 'local' })).toBe('local');
  });
});
