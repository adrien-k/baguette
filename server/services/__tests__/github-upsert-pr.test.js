import { describe, it, expect, vi, afterEach } from 'vitest';
import { upsertPR } from '../github.js';

vi.mock('../github-api.js', () => ({
  githubFetch: vi.fn(),
}));

import { githubFetch } from '../github-api.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe('upsertPR', () => {
  afterEach(() => {
    vi.mocked(githubFetch).mockReset();
  });

  it('includes base when updating an existing pull request', async () => {
    vi.mocked(githubFetch).mockResolvedValue(
      jsonResponse({ html_url: 'https://github.com/o/r/pull/5', number: 5 })
    );

    await upsertPR('token', {
      repoFullName: 'o/r',
      prNumber: 5,
      title: 'Title',
      body: 'Body',
      baseBranch: 'develop',
    });

    expect(githubFetch).toHaveBeenCalledOnce();
    const [, init] = githubFetch.mock.calls[0];
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({
      title: 'Title',
      body: 'Body',
      base: 'develop',
    });
  });

  it('omits base when baseBranch is not set on update', async () => {
    vi.mocked(githubFetch).mockResolvedValue(
      jsonResponse({ html_url: 'https://github.com/o/r/pull/5', number: 5 })
    );

    await upsertPR('token', {
      repoFullName: 'o/r',
      prNumber: 5,
      title: 'Title',
      body: 'Body',
    });

    const [, init] = githubFetch.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ title: 'Title', body: 'Body' });
  });
});
