import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../github-api.js', () => ({
  githubFetch: vi.fn(),
}));

import { githubFetch } from '../github-api.js';
import { searchPublicRepositories } from '../github.js';

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
