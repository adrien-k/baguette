import { describe, it, expect, vi, afterEach } from 'vitest';
import { GitHubBadCredentialsError } from '../../errors/github-errors.js';
import { githubFetch, isGitHubBadCredentialsBody } from '../github-api.js';

describe('isGitHubBadCredentialsBody', () => {
  it('detects GitHub 401 Bad credentials JSON', () => {
    expect(isGitHubBadCredentialsBody('{\r\n  "message": "Bad credentials"\r\n}')).toBe(true);
    expect(isGitHubBadCredentialsBody('{"message":"Bad credentials"}')).toBe(true);
  });

  it('ignores other GitHub errors', () => {
    expect(isGitHubBadCredentialsBody('{"message":"Not Found"}')).toBe(false);
    expect(isGitHubBadCredentialsBody('')).toBe(false);
  });
});

describe('githubFetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws GitHubBadCredentialsError on 401 Bad credentials', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('{\r\n  "message": "Bad credentials"\r\n}', { status: 401 })
        )
    );

    await expect(githubFetch('https://api.github.com/user', { token: 'gho_x' })).rejects.toThrow(
      GitHubBadCredentialsError
    );
  });

  it('returns other 401 responses without throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response('{"message":"Requires authentication"}', { status: 401 }))
    );

    const res = await githubFetch('https://api.github.com/user', { token: 'gho_x' });
    expect(res.status).toBe(401);
  });

  it('applies auth, accept, and user-agent and merges extra headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await githubFetch('https://api.github.com/user', {
      token: 'gho_test',
      accept: 'application/vnd.github+json',
      headers: { 'Content-Type': 'application/json', Range: 'bytes=0-99' },
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer gho_test',
      Accept: 'application/vnd.github+json',
      'User-Agent': 'baguette-app',
      'Content-Type': 'application/json',
      Range: 'bytes=0-99',
    });
  });
});
