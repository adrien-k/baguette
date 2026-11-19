import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../github-api.js', () => ({
  githubFetch: vi.fn(),
}));

import { githubFetch } from '../github-api.js';
import {
  searchPublicRepositories,
  fetchPublicRepoByFullName,
  findPublicRemoteRepos,
} from '../github.js';

describe('searchPublicRepositories', () => {
  afterEach(() => {
    vi.mocked(githubFetch).mockReset();
  });

  it('requests is:public and quotes the user fragment', async () => {
    vi.mocked(githubFetch).mockResolvedValue(
      new Response(JSON.stringify({ items: [] }), { status: 200 })
    );

    await searchPublicRepositories('token', 'widgets is:private');

    expect(githubFetch).toHaveBeenCalledOnce();
    const url = new URL(vi.mocked(githubFetch).mock.calls[0][0]);
    expect(url.searchParams.get('q')).toBe('"widgets is:private" in:name is:public');
  });

  it('still filters private items as a backstop', async () => {
    vi.mocked(githubFetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            { full_name: 'a/secret', private: true, default_branch: 'main' },
            { full_name: 'b/open', private: false, default_branch: 'main' },
          ],
        }),
        { status: 200 }
      )
    );

    const repos = await searchPublicRepositories('token', 'open');
    expect(repos).toEqual([{ full_name: 'b/open', private: false, default_branch: 'main' }]);
  });
});

describe('fetchPublicRepoByFullName', () => {
  afterEach(() => {
    vi.mocked(githubFetch).mockReset();
  });

  it('rejects dot-dot owner/repo without calling GitHub', async () => {
    const result = await fetchPublicRepoByFullName('token', '../..');
    expect(result).toBeNull();
    expect(githubFetch).not.toHaveBeenCalled();
  });

  it('treats a 200 body without full_name as not found', async () => {
    vi.mocked(githubFetch).mockResolvedValue(
      new Response(JSON.stringify({ current_user_url: 'https://api.github.com/user' }), {
        status: 200,
      })
    );

    const result = await fetchPublicRepoByFullName('token', 'valid/repo');
    expect(result).toBeNull();
  });
});

describe('findPublicRemoteRepos', () => {
  afterEach(() => {
    vi.mocked(githubFetch).mockReset();
  });

  it('does not throw on dot-dot queries and can fall back to search', async () => {
    vi.mocked(githubFetch).mockResolvedValue(
      new Response(JSON.stringify({ items: [] }), { status: 200 })
    );

    await expect(findPublicRemoteRepos('token', { query: '../..' })).resolves.toEqual([]);
    expect(githubFetch).toHaveBeenCalledOnce();
    const url = new URL(vi.mocked(githubFetch).mock.calls[0][0]);
    expect(url.pathname).toBe('/search/repositories');
  });
});
